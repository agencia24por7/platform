import Link from 'next/link';
import { Feedback } from '@/../app/_components/Feedback';
import { Marca } from '@/../app/_components/Marca';
import { carregarContas, carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import {
  alternarColeta,
  desvincularContaDeAnuncio,
  desvincularFonte,
  moverConta,
  moverFonte,
} from '@/../app/clientes/[id]/(painel)/dados/acoes';
import { modules } from '@/composition';
import {
  ROTULO_DA_PLATAFORMA,
  ROTULO_DO_RECURSO,
  temRecursoParaVincular,
  type Platform,
} from '@/modules/connections/domain/connection';
import { frescorPelaColeta } from '@/modules/clients/domain/painel/brain/frescor';
import { ROTULO_DO_FRESCOR } from '@/modules/clients/domain/painel/brain/tipos';
import { saudeDosDados, tempoRelativo } from '@/modules/clients/domain/painel/resumo';

export const dynamic = 'force-dynamic';

const ROTULO_DO_STATUS: Record<string, { readonly rotulo: string; readonly tom: string }> = {
  linked: { rotulo: 'Vinculada', tom: 'pill--ok' },
  pending: { rotulo: 'Pendente', tom: 'pill--warn' },
  error: { rotulo: 'Com erro', tom: 'pill--danger' },
  unlinked: { rotulo: 'Desvinculada', tom: '' },
};

export default async function DadosDoCliente({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  const { ctx, cliente, podeEditar } = await carregarPainel(id);
  const [[contas, fontes], irmaos, conexoes] = await Promise.all([
    carregarContas(ctx.organization.id, cliente.id),
    modules().clients.list(ctx.organization.id),
    modules().connections.listConnections(ctx.organization.id),
  ]);
  const agora = new Date();
  const destinos = irmaos.filter((item) => item.id !== cliente.id);
  const destinosAtivos = destinos.filter((item) => item.status === 'active');
  const nomeDaConexao = new Map(conexoes.map((c) => [c.id, c.label]));
  const saude = saudeDosDados(contas, agora);

  const plataformas = [...new Set<Platform>([...contas.map((c) => c.platform), ...fontes.map((f) => f.platform)])];

  return (
    <div className="pilha">
      <Feedback message={primeiro(busca['erro'])} tone="error" />
      <Feedback message={primeiro(busca['feito'])} tone="ok" />

      <div className="dados-topo">
        <dl className="placar placar--linha">
          <div className="placar__item"><dt>Contas de anúncio</dt><dd>{contas.length}</dd></div>
          <div className="placar__item"><dt>Fontes de dados</dt><dd>{fontes.length}</dd></div>
          <div className="placar__item placar__item--fresco"><dt>Coleta em dia</dt><dd>{saude.frescas}</dd></div>
          <div className="placar__item placar__item--atrasado"><dt>Atrasadas ou nunca</dt><dd>{saude.atrasadas + saude.paradas + saude.nunca}</dd></div>
        </dl>
        {podeEditar ? (
          <Link className="btn btn--primary" href={`/clientes/${cliente.id}/contas/nova`}>
            Vincular conta ou fonte
          </Link>
        ) : null}
      </div>

      {plataformas.length === 0 ? (
        <div className="vazio">
          <div className="vazio__titulo">Nenhuma conta ou fonte vinculada</div>
          <p className="vazio__texto">
            A coleta só enxerga contas vinculadas e com sincronização ligada. GA4, Search Console, YouTube, Tag Manager e
            Perfil da Empresa também aparecem aqui depois de vinculados: é o vínculo que dá dono ao dado coletado.
          </p>
          {podeEditar ? (
            <Link className="btn btn--primary" href={`/clientes/${cliente.id}/contas/nova`}>
              Conectar conta
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="grade-auto grade-auto--larga">
          {plataformas.map((plataforma) => {
            const doGrupo = contas.filter((c) => c.platform === plataforma);
            const fontesDoGrupo = fontes.filter((f) => f.platform === plataforma);
            return (
              <section key={plataforma} className="card plataforma" aria-labelledby={`plat-${plataforma}`}>
                <header className="plataforma__topo">
                  <Marca platform={plataforma} tamanho={32} />
                  <div className="plataforma__quem">
                    <h2 className="card__title" id={`plat-${plataforma}`}>{ROTULO_DA_PLATAFORMA[plataforma]}</h2>
                    <span className="card__sub">
                      {[doGrupo.length ? `${doGrupo.length} conta(s)` : null, fontesDoGrupo.length ? `${fontesDoGrupo.length} fonte(s)` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                </header>
                <ul className="itens-de-dado">
                  {doGrupo.map((conta) => {
                    const frescor = conta.syncEnabled ? frescorPelaColeta(conta.lastSyncAt, agora) : 'parado';
                    const status = ROTULO_DO_STATUS[conta.status] ?? { rotulo: conta.status, tom: '' };
                    return (
                      <li key={conta.id} className="item-de-dado">
                        <div className="item-de-dado__principal">
                          <span className="strong">{conta.name}</span>
                          <span className="mono subtle">{conta.externalId}</span>
                          <span className="subtle xsmall">
                            {nomeDaConexao.get(conta.connectionId) ?? 'Conexão'} · {conta.accountGroup} · {conta.currency}
                          </span>
                        </div>
                        <div className="item-de-dado__estado">
                          <span className={`frescor frescor--${frescor}`}>
                            <span className="dot" />
                            {conta.syncEnabled ? ROTULO_DO_FRESCOR[frescor] : 'Coleta pausada'}
                          </span>
                          <span className="subtle xsmall" title={conta.lastSyncAt?.toLocaleString('pt-BR') ?? undefined}>
                            Última coleta {tempoRelativo(conta.lastSyncAt, agora)}
                          </span>
                          <span className={`pill ${status.tom}`}>{status.rotulo}</span>
                        </div>
                        {podeEditar ? (
                          <div className="item-de-dado__acoes">
                            <form action={alternarColeta}>
                              <input type="hidden" name="clientId" value={cliente.id} />
                              <input type="hidden" name="accountId" value={conta.id} />
                              <input type="hidden" name="ligar" value={conta.syncEnabled ? 'nao' : 'sim'} />
                              <button className="btn btn--compacto" type="submit">
                                {conta.syncEnabled ? 'Pausar coleta' : 'Retomar coleta'}
                              </button>
                            </form>
                            {destinos.length > 0 ? (
                              <form action={moverConta} className="form--inline">
                                <input type="hidden" name="clientId" value={cliente.id} />
                                <input type="hidden" name="accountId" value={conta.id} />
                                <select className="select select--compacto" name="destinoId" defaultValue="" required aria-label={`Mover ${conta.name} para outro cliente`}>
                                  <option value="" disabled>Mover para…</option>
                                  {destinos.map((destino) => (
                                    <option key={destino.id} value={destino.id}>{destino.name}</option>
                                  ))}
                                </select>
                                <button className="btn btn--compacto" type="submit">Mover</button>
                              </form>
                            ) : null}
                            <form action={desvincularContaDeAnuncio}>
                              <input type="hidden" name="clientId" value={cliente.id} />
                              <input type="hidden" name="accountId" value={conta.id} />
                              <button className="btn btn--compacto btn--perigo" type="submit" aria-label={`Desvincular ${conta.name}`}>
                                Desvincular
                              </button>
                            </form>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                  {fontesDoGrupo.map((fonte) => (
                    <li key={fonte.id} className="item-de-dado">
                      <div className="item-de-dado__principal">
                        <span className="strong">{fonte.name}</span>
                        <span className="mono subtle">{fonte.externalId}</span>
                        <span className="subtle xsmall">
                          {temRecursoParaVincular(fonte.platform) ? ROTULO_DO_RECURSO[fonte.platform] : 'Fonte'} ·{' '}
                          {nomeDaConexao.get(fonte.connectionId) ?? 'Conexão'}
                        </span>
                      </div>
                      <div className="item-de-dado__estado">
                        <span className="pill pill--info">Entra na coleta</span>
                      </div>
                      {podeEditar ? (
                        <div className="item-de-dado__acoes">
                          {destinosAtivos.length > 0 ? (
                            <form action={moverFonte} className="form--inline">
                              <input type="hidden" name="clientId" value={cliente.id} />
                              <input type="hidden" name="recursoId" value={fonte.id} />
                              <select className="select select--compacto" name="destinoId" defaultValue="" required aria-label={`Cliente que passa a ser dono de ${fonte.name}`}>
                                <option value="" disabled>Mover para…</option>
                                {destinosAtivos.map((destino) => (
                                  <option key={destino.id} value={destino.id}>{destino.name}</option>
                                ))}
                              </select>
                              <button className="btn btn--compacto" type="submit">Mover</button>
                            </form>
                          ) : null}
                          <form action={desvincularFonte}>
                            <input type="hidden" name="clientId" value={cliente.id} />
                            <input type="hidden" name="recursoId" value={fonte.id} />
                            <button className="btn btn--compacto btn--perigo" type="submit" aria-label={`Desvincular ${fonte.name}`}>
                              Desvincular
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
