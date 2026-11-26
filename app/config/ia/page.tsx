import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { EstadoComIcone } from '@/../app/_components/EstadoComIcone';
import { MensagemDaUrl } from '@/../app/_components/MensagemDaUrl';
import { Shell } from '@/../app/_components/Shell';
import { ConfirmarAcao } from '@/../app/clientes/[id]/_componentes/ConfirmarAcao';
import { TesteDeModelo } from '@/../app/config/ia/TesteDeModelo';
import { atualizarModelos, definirTetos, escolherModelo, guardarChave, ligarOuDesligar, removerChave } from '@/../app/config/ia/acoes';
import { modules } from '@/composition';
import { ROTULO_DO_FORNECEDOR } from '@/modules/ia/domain/modelos';
import { TESTE_DE_MODELO } from '@/modules/ia/domain/tarefasInternas';
import type { ClasseDeCapacidade } from '@/modules/ia/domain/tarefa';
import { apresentarChaveDoFornecedor, apresentarEstadoDaTarefa, apresentarLigada } from '@/modules/ia/interface/apresentacao';
import { canAdminister } from '@/modules/identity/domain/user';
import { requireContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Inteligência artificial' };

const ROTULO_DA_CLASSE: Record<ClasseDeCapacidade, string> = {
  rapido_e_barato: 'Sugestão: um modelo rápido e barato.',
  raciocinio_forte: 'Sugestão: um modelo de raciocínio forte.',
};

const numero = new Intl.NumberFormat('pt-BR');
const dia = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export default async function InteligenciaArtificialPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; feito?: string; n?: string }>;
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
  const estadoLigada = apresentarLigada(configuracao.ligada);

  return (
    <Shell title="Inteligência artificial" organization={organization} active="/config">
      <div className="tela-config">
        <div className="page__head">
          <div>
            <h1 className="page__title">Inteligência artificial</h1>
            <p className="page__sub">
              A organização usa a própria chave de cada fornecedor e escolhe o modelo de cada tarefa. <Link href="/config">Voltar às configurações</Link>
            </p>
            <ol className="config-passos">
              <li>Guarde a chave de um fornecedor.</li>
              <li>Escolha o modelo de cada tarefa.</li>
              <li>Faça um teste e confira o uso do dia.</li>
            </ol>
          </div>
        </div>

        <MensagemDaUrl erro={params.erro} feito={params.feito} n={params.n} />

        <section className="card" aria-labelledby="t-estado">
          <h2 className="card__head card__title" id="t-estado">
            Estado da IA
          </h2>
          <div className="card__body">
            <div className="row">
              <EstadoComIcone estado={estadoLigada} />
              <p className="card__ajuda">{estadoLigada.explicacao}</p>
            </div>
            <div className="acoes">
              {configuracao.ligada ? (
                <ConfirmarAcao
                  gatilho="Desligar a IA da organização"
                  titulo="Desligar a IA da organização?"
                  descricao="Enquanto estiver desligada, nenhuma tarefa chama modelo. As chaves e as escolhas continuam guardadas e você liga de novo quando quiser."
                  confirmar="Desligar a IA"
                  pendente="Desligando…"
                  action={ligarOuDesligar}
                  gatilhoClasse="btn"
                >
                  <input type="hidden" name="ligada" value="nao" />
                </ConfirmarAcao>
              ) : (
                <form action={ligarOuDesligar}>
                  <input type="hidden" name="ligada" value="sim" />
                  <BotaoDeEnvio className="btn btn--primary" pendente="Ligando…">
                    Ligar a IA da organização
                  </BotaoDeEnvio>
                </form>
              )}
            </div>
          </div>
        </section>

        <section className="card" id="chaves" aria-labelledby="t-chaves">
          <h2 className="card__head card__title" id="t-chaves">
            Chaves dos fornecedores
          </h2>
          <div className="card__body">
            <p className="card__ajuda">
              A chave é testada no fornecedor e guardada cifrada no cofre. Depois de guardada ela não é mais exibida. O conteúdo que as tarefas enviam ao
              modelo sai da plataforma para o fornecedor escolhido.
            </p>
          </div>
          {fornecedores.map(({ fornecedor, chave }) => {
            const nome = ROTULO_DO_FORNECEDOR[fornecedor];
            return (
              <section key={fornecedor} className="config-bloco" aria-labelledby={`t-fornecedor-${fornecedor}`}>
                <div className="bloco__topo">
                  <h3 className="bloco__nome" id={`t-fornecedor-${fornecedor}`}>
                    {nome}
                  </h3>
                  <EstadoComIcone estado={apresentarChaveDoFornecedor(chave !== null)} />
                </div>
                {chave ? (
                  <p className="card__ajuda">
                    Chave <span className="mono">{chave.rotulo}</span> guardada. {chave.modelos.length} modelos de texto ao alcance
                    {chave.modelosListadosEm ? `, lista de ${dia.format(chave.modelosListadosEm)}` : ''}.
                  </p>
                ) : (
                  <p className="card__ajuda">Cole abaixo a chave de API da sua conta {nome}. Sem ela, as tarefas não podem usar este fornecedor.</p>
                )}
                <form className="form--acoes" action={guardarChave}>
                  <input type="hidden" name="fornecedor" value={fornecedor} />
                  <label className="field">
                    <span className="field__label">{chave ? `Trocar a chave de ${nome}` : `Chave de API de ${nome}`}</span>
                    <input className="input" type="password" name="chave" required minLength={20} maxLength={400} autoComplete="off" spellCheck={false} />
                  </label>
                  <BotaoDeEnvio className="btn btn--primary" pendente="Testando…" ariaLabel={`Testar e guardar a chave de ${nome}`}>
                    Testar e guardar
                  </BotaoDeEnvio>
                </form>
                {chave ? (
                  <div className="acoes">
                    <form action={atualizarModelos}>
                      <input type="hidden" name="fornecedor" value={fornecedor} />
                      <BotaoDeEnvio className="btn btn--compacto" pendente="Atualizando…" ariaLabel={`Atualizar lista de modelos de ${nome}`}>
                        Atualizar lista de modelos
                      </BotaoDeEnvio>
                    </form>
                    <ConfirmarAcao
                      gatilho="Remover chave"
                      rotuloDoGatilho={`Remover a chave de ${nome}`}
                      titulo={`Remover a chave de ${nome}?`}
                      descricao="As tarefas que usam este fornecedor ficam bloqueadas até você guardar outra chave. Para voltar, será preciso colar a chave de novo."
                      confirmar="Remover chave"
                      pendente="Removendo…"
                      action={removerChave}
                    >
                      <input type="hidden" name="fornecedor" value={fornecedor} />
                    </ConfirmarAcao>
                  </div>
                ) : null}
              </section>
            );
          })}
        </section>

        {chavesDeFornecedorDesligado.length > 0 ? (
          <section className="card" aria-labelledby="t-desligados">
            <h2 className="card__head card__title" id="t-desligados">
              Chaves de fornecedor desligado
            </h2>
            <div className="card__body">
              <p className="card__ajuda">Estes fornecedores não estão mais habilitados na plataforma. As chaves continuam guardadas e nenhuma tarefa as usa.</p>
            </div>
            {chavesDeFornecedorDesligado.map((chave) => (
              <div key={chave.fornecedor} className="config-bloco">
                <div className="bloco__topo">
                  <span>
                    {ROTULO_DO_FORNECEDOR[chave.fornecedor]} <span className="mono">{chave.rotulo}</span>
                  </span>
                  <ConfirmarAcao
                    gatilho="Remover chave desligada"
                    rotuloDoGatilho={`Remover a chave desligada de ${ROTULO_DO_FORNECEDOR[chave.fornecedor]}`}
                    titulo={`Remover a chave de ${ROTULO_DO_FORNECEDOR[chave.fornecedor]}?`}
                    descricao="A chave sai do cofre e não poderá ser recuperada daqui."
                    confirmar="Remover chave desligada"
                    pendente="Removendo…"
                    action={removerChave}
                  >
                    <input type="hidden" name="fornecedor" value={chave.fornecedor} />
                  </ConfirmarAcao>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <section className="card" aria-labelledby="t-modelos">
          <h2 className="card__head card__title" id="t-modelos">
            Modelo por tarefa
          </h2>
          <div className="card__body">
            <p className="card__ajuda">Cada tarefa da plataforma usa o modelo que você escolher aqui. Sem modelo, a tarefa fica bloqueada.</p>
          </div>
          {comChave.length === 0 ? (
            <div className="vazio">
              <p className="card__ajuda">Guarde a chave de um fornecedor para escolher modelos.</p>
              <a className="btn" href="#chaves">
                Ir para as chaves
              </a>
            </div>
          ) : (
            tarefas.map((tarefa) => {
              const estado = apresentarEstadoDaTarefa(tarefa.estado);
              return (
                <form key={tarefa.chave} className="config-bloco" action={escolherModelo}>
                  <input type="hidden" name="tarefa" value={tarefa.chave} />
                  <div className="form--acoes">
                    <label className="field">
                      <span className="field__label">{tarefa.titulo}</span>
                      <select
                        className="select"
                        name="escolha"
                        required
                        defaultValue={tarefa.escolha ? `${tarefa.escolha.fornecedor}|${tarefa.escolha.modelo}` : ''}
                      >
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
                    </label>
                    <BotaoDeEnvio className="btn" pendente="Salvando…" ariaLabel={`Salvar modelo da tarefa ${tarefa.titulo}`}>
                      Salvar
                    </BotaoDeEnvio>
                  </div>
                  <div className="row">
                    <EstadoComIcone estado={estado} />
                    <span className="field__hint">
                      {estado.explicacao ? `${estado.explicacao} ` : ''}
                      {ROTULO_DA_CLASSE[tarefa.classe]}
                    </span>
                  </div>
                </form>
              );
            })
          )}
        </section>

        <section className="card" aria-labelledby="t-teste">
          <h2 className="card__head card__title" id="t-teste">
            Testar
          </h2>
          <div className="card__body">
            {testeConfigurado ? (
              <>
                <p className="card__ajuda">Faz uma chamada mínima ao modelo da tarefa “Teste de modelo”, sem dado de cliente, e conta no uso do dia.</p>
                <TesteDeModelo />
              </>
            ) : (
              <>
                <p className="card__ajuda">Escolha um modelo para a tarefa “Teste de modelo” para liberar o teste.</p>
                {comChave.length > 0 ? (
                  <div className="acoes">
                    <a className="btn" href="#t-modelos">
                      Ir para o modelo por tarefa
                    </a>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="t-uso">
          <h2 className="card__head card__title" id="t-uso">
            Uso e limites
          </h2>
          <div className="card__body">
            <p className="card__ajuda">Ao atingir um dos tetos, as tarefas param até o dia seguinte.</p>
          </div>
          <div className="uso">
            <div className="uso__item">
              <span className="uso__rotulo" id="uso-chamadas">
                Chamadas hoje
              </span>
              <span className="uso__valor">
                {numero.format(usoDeHoje.chamadas)} de {numero.format(configuracao.chamadasPorDia)}
              </span>
              <progress className="config-barra" aria-labelledby="uso-chamadas" value={Math.min(usoDeHoje.chamadas, configuracao.chamadasPorDia)} max={configuracao.chamadasPorDia} />
            </div>
            <div className="uso__item">
              <span className="uso__rotulo" id="uso-tokens">
                Tokens hoje
              </span>
              <span className="uso__valor">
                {numero.format(usoDeHoje.tokens)} de {numero.format(configuracao.tokensPorDia)}
              </span>
              <progress className="config-barra" aria-labelledby="uso-tokens" value={Math.min(usoDeHoje.tokens, configuracao.tokensPorDia)} max={configuracao.tokensPorDia} />
            </div>
          </div>
          {ctx.role === 'owner' ? (
            <form className="config-bloco form--acoes" action={definirTetos}>
              <label className="field">
                <span className="field__label">Chamadas por dia</span>
                <input className="input" type="number" name="chamadasPorDia" required min={1} max={100000} defaultValue={configuracao.chamadasPorDia} />
              </label>
              <label className="field">
                <span className="field__label">Tokens por dia</span>
                <input className="input" type="number" name="tokensPorDia" required min={1000} max={1000000000} defaultValue={configuracao.tokensPorDia} />
              </label>
              <BotaoDeEnvio className="btn" pendente="Salvando…">
                Salvar tetos
              </BotaoDeEnvio>
            </form>
          ) : (
            <div className="config-bloco">
              <p className="card__ajuda">Só quem responde pela organização muda os tetos.</p>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}
