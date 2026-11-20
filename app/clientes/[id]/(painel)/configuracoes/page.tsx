import { Feedback } from '@/../app/_components/Feedback';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { carregarContexto, carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { mudarSituacao } from '@/../app/clientes/[id]/(painel)/dados/acoes';
import { EFEITO_DA_SITUACAO, ROTULO_DA_SITUACAO, SITUACOES, mudancaPermitida } from '@/modules/clients/domain/ciclo';
import { tamanhoLegivel } from '@/modules/clients/domain/painel/formato';

export const dynamic = 'force-dynamic';

const ROTULO_DO_BRAIN: Record<string, string> = {
  desativado: 'Armazenamento não configurado neste ambiente',
  nunca_publicado: 'Ainda não publicado',
  em_dia: 'Publicado e em dia',
  pendente: 'Publicação pendente',
  com_erro: 'Última publicação falhou',
};

export default async function ConfiguracoesDoCliente({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  const { ctx, cliente, podeEditar } = await carregarPainel(id);
  const contexto = await carregarContexto(ctx.organization.id, cliente.id);
  const opcoes = SITUACOES.filter((valor) => mudancaPermitida(ctx.role, valor) === null);

  return (
    <div className="grade-auto grade-auto--larga">
      <div className="pilha grade__inteira">
        <Feedback message={primeiro(busca['erro'])} tone="error" />
        <Feedback message={primeiro(busca['feito'])} tone="ok" />
      </div>
      <section className="card" aria-labelledby="t-situacao">
        <div className="card__head">
          <h2 className="card__title" id="t-situacao">Situação</h2>
          <span className={`pill ${cliente.status === 'active' ? 'pill--ok' : cliente.status === 'paused' ? 'pill--warn' : ''}`}>
            {ROTULO_DA_SITUACAO[cliente.status]}
          </span>
        </div>
        <div className="card__body">
          <ul className="situacoes">
            {SITUACOES.map((valor) => (
              <li key={valor} className={valor === cliente.status ? 'situacao situacao--atual' : 'situacao'}>
                <span className="strong">{ROTULO_DA_SITUACAO[valor]}</span>
                <span className="subtle small">{EFEITO_DA_SITUACAO[valor]}</span>
              </li>
            ))}
          </ul>
          {podeEditar ? (
            <form className="form--inline" action={mudarSituacao}>
              <input type="hidden" name="clientId" value={cliente.id} />
              <label className="field">
                <span className="field__label">Mudar para</span>
                <select className="select" name="situacao" defaultValue={cliente.status}>
                  {opcoes.map((valor) => (
                    <option key={valor} value={valor}>{ROTULO_DA_SITUACAO[valor]}</option>
                  ))}
                </select>
              </label>
              <BotaoDeEnvio className="btn" pendente="Aplicando…">Aplicar</BotaoDeEnvio>
              <span className="field__hint">Pausar ou arquivar tira as contas da fila de coleta. Nada é apagado. Arquivar é decisão de quem administra.</span>
            </form>
          ) : (
            <p className="subtle small">Seu papel permite só consultar a situação.</p>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="t-armazenamento">
        <div className="card__head">
          <h2 className="card__title" id="t-armazenamento">Arquivos e brain</h2>
        </div>
        <div className="card__body">
          <dl className="fatos">
            <div className="fatos__item">
              <dt className="fatos__rotulo">Arquivos do contexto</dt>
              <dd>{contexto ? `${tamanhoLegivel(contexto.usoDeArquivosBytes)} de ${tamanhoLegivel(contexto.cotaDeArquivosBytes)}` : '—'}</dd>
            </div>
            <div className="fatos__item">
              <dt className="fatos__rotulo">Brain publicado</dt>
              <dd>{contexto ? ROTULO_DO_BRAIN[contexto.brain.situacao] ?? contexto.brain.situacao : '—'}</dd>
            </div>
            {contexto?.brain.exportadoEm ? (
              <div className="fatos__item">
                <dt className="fatos__rotulo">Última publicação</dt>
                <dd>{contexto.brain.exportadoEm.toLocaleString('pt-BR')}</dd>
              </div>
            ) : null}
          </dl>
          <p className="subtle small">
            Excluir um cliente é lógico (ADR 0022): ele some das listas, os links de contexto são revogados e o histórico
            coletado segue auditável até o expurgo. Peça a exclusão a quem administra a organização.
          </p>
        </div>
      </section>
    </div>
  );
}
