import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Feedback } from '@/../app/_components/Feedback';
import { Shell } from '@/../app/_components/Shell';
import { TesteDeModelo } from '@/../app/config/ia/TesteDeModelo';
import { atualizarModelos, definirTetos, escolherModelo, guardarChave, ligarOuDesligar, removerChave } from '@/../app/config/ia/acoes';
import { modules } from '@/composition';
import { ROTULO_DO_FORNECEDOR, type EstadoDaTarefa } from '@/modules/ia/domain/modelos';
import { TESTE_DE_MODELO } from '@/modules/ia/domain/tarefasInternas';
import type { ClasseDeCapacidade } from '@/modules/ia/domain/tarefa';
import { canAdminister } from '@/modules/identity/domain/user';
import { requireContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

const ROTULO_DO_ESTADO: Record<EstadoDaTarefa, string> = {
  configurada: 'Configurada',
  sem_modelo: 'Sem modelo: a tarefa está bloqueada',
  modelo_indisponivel: 'Modelo indisponível: escolha outro ou atualize a lista',
};

const ROTULO_DA_CLASSE: Record<ClasseDeCapacidade, string> = {
  rapido_e_barato: 'Sugestão: um modelo rápido e barato',
  raciocinio_forte: 'Sugestão: um modelo de raciocínio forte',
};

const numero = new Intl.NumberFormat('pt-BR');
const dia = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export default async function InteligenciaArtificialPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; feito?: string }>;
}) {
  const ctx = await requireContext();
  if (ctx.clientIds !== null || !canAdminister(ctx.role)) redirect('/config');
  const params = await searchParams;

  const organization = ctx.organization;
  const painel = await modules().ia.modelos.painel({ organizationId: organization.id, papelDeQuemAge: ctx.role });
  if (!painel.ok) redirect('/config');
  const { configuracao, usoDeHoje, fornecedores, tarefas, chavesDeFornecedorDesligado } = painel.value;
  const comChave = fornecedores.filter((item) => item.chave !== null);
  const testeConfigurado = tarefas.some((tarefa) => tarefa.chave === TESTE_DE_MODELO.chave && tarefa.escolha !== null);

  return (
    <Shell title="Inteligência artificial" organization={organization} active="/config">
      <div className="page__head">
        <div>
          <div className="page__title">Inteligência artificial</div>
          <div className="page__sub">
            A organização usa a própria chave de cada fornecedor e escolhe o modelo de cada tarefa. <Link href="/config">Voltar às configurações</Link>
          </div>
        </div>
      </div>

      <Feedback message={params.erro} tone="error" />
      <Feedback message={params.feito} tone="ok" />

      <div className="card">
        <div className="card__head">Uso e limites</div>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              <tr>
                <td className="strong">Estado</td>
                <td>{configuracao.ligada ? 'Ligada' : 'Desligada: nenhuma tarefa chama modelo'}</td>
              </tr>
              <tr>
                <td className="strong">Chamadas hoje</td>
                <td className="muted">
                  {numero.format(usoDeHoje.chamadas)} de {numero.format(configuracao.chamadasPorDia)}
                </td>
              </tr>
              <tr>
                <td className="strong">Tokens hoje</td>
                <td className="muted">
                  {numero.format(usoDeHoje.tokens)} de {numero.format(configuracao.tokensPorDia)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <form action={ligarOuDesligar}>
          <input type="hidden" name="ligada" value={configuracao.ligada ? 'nao' : 'sim'} />
          <button className="btn" type="submit">
            {configuracao.ligada ? 'Desligar a IA da organização' : 'Ligar a IA da organização'}
          </button>
        </form>
        {ctx.role === 'owner' ? (
          <form className="form form--linha" action={definirTetos}>
            <label className="field">
              <span className="field__label">Chamadas por dia</span>
              <input className="input" type="number" name="chamadasPorDia" required min={1} max={100000} defaultValue={configuracao.chamadasPorDia} />
            </label>
            <label className="field">
              <span className="field__label">Tokens por dia</span>
              <input className="input" type="number" name="tokensPorDia" required min={1000} max={1000000000} defaultValue={configuracao.tokensPorDia} />
              <span className="field__hint">Ao atingir um dos tetos, as tarefas param até o dia seguinte.</span>
            </label>
            <button className="btn" type="submit">
              Salvar tetos
            </button>
          </form>
        ) : (
          <p className="muted">Só quem responde pela organização muda os tetos.</p>
        )}
      </div>

      <div className="card">
        <div className="card__head">Chaves dos fornecedores</div>
        <p className="muted">
          A chave é testada no fornecedor e guardada cifrada no cofre. Depois de guardada ela não é mais exibida. O conteúdo que as tarefas enviam ao modelo
          sai da plataforma para o fornecedor escolhido.
        </p>
        {fornecedores.map(({ fornecedor, chave }) => (
          <div key={fornecedor} className="card">
            <div className="card__head">{ROTULO_DO_FORNECEDOR[fornecedor]}</div>
            {chave ? (
              <p className="muted">
                Chave <span className="mono">{chave.rotulo}</span> guardada. {chave.modelos.length} modelos de texto ao alcance
                {chave.modelosListadosEm ? `, lista de ${dia.format(chave.modelosListadosEm)}` : ''}.
              </p>
            ) : (
              <p className="muted">Sem chave. As tarefas não podem usar este fornecedor.</p>
            )}
            <form className="form form--linha" action={guardarChave}>
              <input type="hidden" name="fornecedor" value={fornecedor} />
              <label className="field">
                <span className="field__label">{chave ? 'Trocar a chave' : 'Chave de API'}</span>
                <input className="input" type="password" name="chave" required minLength={20} maxLength={400} autoComplete="off" spellCheck={false} />
              </label>
              <button className="btn btn--primary" type="submit">
                Testar e guardar
              </button>
            </form>
            {chave ? (
              <>
                <form action={atualizarModelos}>
                  <input type="hidden" name="fornecedor" value={fornecedor} />
                  <button className="btn btn--compacto" type="submit">
                    Atualizar lista de modelos
                  </button>
                </form>
                <form action={removerChave}>
                  <input type="hidden" name="fornecedor" value={fornecedor} />
                  <button className="btn btn--compacto" type="submit">
                    Remover chave
                  </button>
                </form>
              </>
            ) : null}
          </div>
        ))}
      </div>

      {chavesDeFornecedorDesligado.length > 0 ? (
        <div className="card">
          <div className="card__head">Chaves de fornecedor desligado</div>
          <p className="muted">Estes fornecedores não estão mais habilitados na plataforma. As chaves continuam guardadas e nenhuma tarefa as usa.</p>
          {chavesDeFornecedorDesligado.map((chave) => (
            <form key={chave.fornecedor} className="form form--linha" action={removerChave}>
              <input type="hidden" name="fornecedor" value={chave.fornecedor} />
              <span>
                {ROTULO_DO_FORNECEDOR[chave.fornecedor]} <span className="mono muted">{chave.rotulo}</span>
              </span>
              <button className="btn btn--compacto" type="submit">
                Remover chave desligada
              </button>
            </form>
          ))}
        </div>
      ) : null}

      <div className="card">
        <div className="card__head">Modelo por tarefa</div>
        {comChave.length === 0 ? (
          <p className="muted">Guarde a chave de um fornecedor para escolher modelos.</p>
        ) : (
          tarefas.map((tarefa) => (
            <form key={tarefa.chave} className="form form--linha" action={escolherModelo}>
              <input type="hidden" name="tarefa" value={tarefa.chave} />
              <label className="field">
                <span className="field__label">{tarefa.titulo}</span>
                <select className="select" name="escolha" required defaultValue={tarefa.escolha ? `${tarefa.escolha.fornecedor}|${tarefa.escolha.modelo}` : ''}>
                  <option value="" disabled>
                    Escolha um modelo
                  </option>
                  {comChave.map(({ fornecedor, chave }) => (
                    <optgroup key={fornecedor} label={ROTULO_DO_FORNECEDOR[fornecedor]}>
                      {(chave?.modelos ?? []).map((modelo) => (
                        <option key={modelo} value={`${fornecedor}|${modelo}`}>
                          {modelo}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span className="field__hint">
                  {ROTULO_DO_ESTADO[tarefa.estado]}. {ROTULO_DA_CLASSE[tarefa.classe]}.
                </span>
              </label>
              <button className="btn" type="submit">
                Salvar
              </button>
            </form>
          ))
        )}
      </div>

      <div className="card">
        <div className="card__head">Testar</div>
        {testeConfigurado ? (
          <>
            <p className="muted">Faz uma chamada mínima ao modelo da tarefa “Teste de modelo”, sem dado de cliente, e conta no uso do dia.</p>
            <TesteDeModelo />
          </>
        ) : (
          <p className="muted">Escolha um modelo para a tarefa “Teste de modelo” para liberar o teste.</p>
        )}
      </div>
    </Shell>
  );
}
