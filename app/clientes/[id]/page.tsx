import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Feedback } from '@/../app/_components/Feedback';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import {
  EFEITO_DA_SITUACAO,
  ROTULO_DA_SITUACAO,
  SITUACOES,
  mudancaPermitida,
} from '@/modules/clients/domain/ciclo';
import { canAdminister, canOperate } from '@/modules/identity/domain/user';
import { atorAtual } from '@/shared/http/ator';
import { text, toActionState } from '@/shared/http/actions';
import { requireContext } from '@/shared/http/currentOrganization';
import { env } from '@/shared/config/env';
import {
  ROTULO_DA_PLATAFORMA,
  ROTULO_DO_RECURSO,
  temRecursoParaVincular,
} from '@/modules/connections/domain/connection';
import { pedirAcessoMetaPartner, revogarConviteDeIntegracao } from '@/../app/clientes/[id]/acoes';
import { CopyButton } from '@/../app/_components/CopyButton';

export const dynamic = 'force-dynamic';

async function mudarSituacao(formData: FormData): Promise<void> {
  'use server';

  const ctx = await requireContext();
  const clientId = text(formData, 'clientId');

  const resultado = await modules().clients.mudarSituacao(
    {
      organizationId: ctx.organization.id,
      papelDeQuemAge: ctx.role,
      clientId,
      situacao: text(formData, 'situacao'),
    },
    await atorAtual(),
  );

  const destino = `/clientes/${clientId}`;
  if (!resultado.ok) {
    redirect(`${destino}?erro=${encodeURIComponent(toActionState(resultado.error).error ?? '')}`);
  }
  redirect(`${destino}?feito=${encodeURIComponent('Situação atualizada.')}`);
}

async function moverConta(formData: FormData): Promise<void> {
  'use server';

  const ctx = await requireContext();
  const origem = text(formData, 'clientId');

  const resultado = await modules().connections.reassignAccount(
    {
      organizationId: ctx.organization.id,
      papelDeQuemAge: ctx.role,
      accountId: text(formData, 'accountId'),
      clientId: text(formData, 'destinoId'),
    },
    await atorAtual(),
  );

  const destino = `/clientes/${origem}`;
  if (!resultado.ok) {
    redirect(`${destino}?erro=${encodeURIComponent(toActionState(resultado.error).error ?? '')}`);
  }
  redirect(`${destino}?feito=${encodeURIComponent('Conta movida. O histórico foi junto.')}`);
}

async function alternarColeta(formData: FormData): Promise<void> {
  'use server';

  const ctx = await requireContext();
  const origem = text(formData, 'clientId');

  const resultado = await modules().connections.setAccountSync(
    {
      organizationId: ctx.organization.id,
      papelDeQuemAge: ctx.role,
      accountId: text(formData, 'accountId'),
      enabled: text(formData, 'ligar') === 'sim',
    },
    await atorAtual(),
  );

  const destino = `/clientes/${origem}`;
  if (!resultado.ok) {
    redirect(`${destino}?erro=${encodeURIComponent(toActionState(resultado.error).error ?? '')}`);
  }
  redirect(`${destino}?feito=${encodeURIComponent('Coleta atualizada.')}`);
}

async function desvincularContaDeAnuncio(formData: FormData): Promise<void> {
  'use server';

  const ctx = await requireContext();
  const origem = text(formData, 'clientId');

  const resultado = await modules().connections.unlinkAccount(
    {
      organizationId: ctx.organization.id,
      papelDeQuemAge: ctx.role,
      accountId: text(formData, 'accountId'),
    },
    await atorAtual(),
  );

  const destino = `/clientes/${origem}`;
  if (!resultado.ok) {
    redirect(`${destino}?erro=${encodeURIComponent(toActionState(resultado.error).error ?? '')}`);
  }
  redirect(`${destino}?feito=${encodeURIComponent('Conta desvinculada. Sai da coleta; o histórico coletado continua no BigQuery.')}`);
}

async function moverFonte(formData: FormData): Promise<void> {
  'use server';

  const ctx = await requireContext();
  const origem = text(formData, 'clientId');

  const resultado = await modules().recursos.mover(
    {
      organizationId: ctx.organization.id,
      papelDeQuemAge: ctx.role,
      recursoId: text(formData, 'recursoId'),
      clientId: text(formData, 'destinoId'),
    },
    await atorAtual(),
  );

  const destino = `/clientes/${origem}`;
  if (!resultado.ok) {
    redirect(`${destino}?erro=${encodeURIComponent(toActionState(resultado.error).error ?? '')}`);
  }
  redirect(`${destino}?feito=${encodeURIComponent('Fonte movida. A próxima coleta já grava no novo cliente.')}`);
}

async function desvincularFonte(formData: FormData): Promise<void> {
  'use server';

  const ctx = await requireContext();
  const origem = text(formData, 'clientId');

  const resultado = await modules().recursos.desvincular(
    {
      organizationId: ctx.organization.id,
      papelDeQuemAge: ctx.role,
      recursoId: text(formData, 'recursoId'),
    },
    await atorAtual(),
  );

  const destino = `/clientes/${origem}`;
  if (!resultado.ok) {
    redirect(`${destino}?erro=${encodeURIComponent(toActionState(resultado.error).error ?? '')}`);
  }
  redirect(`${destino}?feito=${encodeURIComponent('Fonte desvinculada. Ela sai da coleta e volta para a lista sem dono.')}`);
}

const statusTone: Record<string, string> = {
  linked: 'pill--ok',
  pending: 'pill--warn',
  error: 'pill--danger',
  unlinked: 'pill',
};

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; feito?: string }>;
}) {
  const ctx = await requireContext();
  const organization = ctx.organization;

  const [{ id }, aviso] = await Promise.all([params, searchParams]);
  const found = await modules().clients.byId(organization.id, id);
  if (!found.ok) notFound();

  const client = found.value;
  const [accounts, fontes, irmaos, convites, pedidosDePartner, organizacao, conexoes] = await Promise.all([
    modules().connections.listAccountsByClient(organization.id, client.id),
    modules().recursos.listarPorCliente(organization.id, client.id),
    modules().clients.list(organization.id),
    modules().connectionInvites.listByClient(organization.id, client.id),
    modules().tasks.listByClient(organization.id, client.id),
    modules().organizations.byId(organization.id),
    modules().connections.listConnections(organization.id),
  ]);
  const podeMexer = canOperate(ctx.role);
  const podeAdministrar = canAdminister(ctx.role);
  const destinos = irmaos.filter((item) => item.id !== client.id);
  const destinosAtivos = destinos.filter((item) => item.status === 'active');
  const temConexaoMeta = conexoes.some(
    (conexao) =>
      conexao.platform === 'meta' && conexao.grantType === 'oauth_user' && conexao.authorizedVia === 'staff',
  );
  const temBusinessManager = organizacao.ok && Boolean(organizacao.value.businessManagerId);
  const conexaoGoogle = conexoes.find(
    (conexao) => conexao.platform === 'google' && conexao.authorizedVia === 'staff',
  );
  const baseUrl = env().TRIA_APP_BASE_URL;

  return (
    <Shell title={client.name} organization={organization} active="/clientes">
      <div className="page__head">
        <div>
          <div className="page__title">{client.name}</div>
          <div className="page__sub">
            {client.segment ?? 'Sem segmento'} ·{' '}
            {client.businessModel === 'ecommerce' ? 'E-commerce' : 'Leads'}
            {client.parentClientId ? ' · unidade de uma rede' : ''}
          </div>
        </div>
        <div className="page__actions">
          <Link className="btn btn--primary" href={`/clientes/${client.id}/contas/nova`}>
            Conectar conta
          </Link>
        </div>
      </div>

      <Feedback message={aviso.erro} tone="error" />
      <Feedback message={aviso.feito} tone="ok" />

      <div className="card">
        <div className="card__head">
          <span className="card__title">Situação</span>
          <span className="card__sub">{EFEITO_DA_SITUACAO[client.status]}</span>
        </div>
        {podeMexer ? (
          <form className="form form--linha" action={mudarSituacao}>
            <input type="hidden" name="clientId" value={client.id} />
            <label className="field">
              <span className="field__label">Mudar para</span>
              <select className="select" name="situacao" defaultValue={client.status}>
                {SITUACOES.filter((valor) => mudancaPermitida(ctx.role, valor) === null).map((valor) => (
                  <option key={valor} value={valor}>
                    {ROTULO_DA_SITUACAO[valor]}
                  </option>
                ))}
              </select>
              <span className="field__hint">
                Pausar ou arquivar tira as contas deste cliente da fila de coleta. Nada é apagado.
              </span>
            </label>
            <button className="btn" type="submit">
              Aplicar
            </button>
          </form>
        ) : (
          <div className="empty">Hoje está {ROTULO_DA_SITUACAO[client.status].toLowerCase()}.</div>
        )}
      </div>

      <div className="steps">
        <span className="step step--done">1 · Dados do cliente</span>
        <span className={accounts.length + fontes.length > 0 ? 'step step--done' : 'step step--active'}>
          2 · Contas e fontes de dados
        </span>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">Contas de anúncio</span>
          <span className="card__sub">
            {accounts.length === 0
              ? 'Nenhuma conta vinculada — o cliente ainda não entra na fila de coleta'
              : `${accounts.length} vinculada(s)`}
          </span>
        </div>
        {accounts.length === 0 ? (
          <div className="empty">
            A coleta do n8n só enxerga contas vinculadas e com sincronização ligada.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Plataforma</th>
                  <th>Grupo</th>
                  <th>Moeda</th>
                  <th>Coleta</th>
                  <th>Última coleta</th>
                  <th>Status</th>
                  {podeMexer ? <th>Mover para</th> : null}
                  {podeMexer ? <th aria-label="Desvincular" /> : null}
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <div className="strong">{account.name}</div>
                      <div className="mono subtle">{account.externalId}</div>
                    </td>
                    <td>{account.platform === 'meta' ? 'Meta Ads' : 'Google Ads'}</td>
                    <td className="muted">{account.accountGroup}</td>
                    <td className="muted">{account.currency}</td>
                    <td>
                      {podeMexer ? (
                        <form className="form--inline" action={alternarColeta}>
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="accountId" value={account.id} />
                          <input type="hidden" name="ligar" value={account.syncEnabled ? 'nao' : 'sim'} />
                          <button className="btn btn--compacto" type="submit">
                            {account.syncEnabled ? 'Pausar' : 'Retomar'}
                          </button>
                        </form>
                      ) : null}
                      <span className={`pill ${account.syncEnabled ? 'pill--ok' : ''}`}>
                        {account.syncEnabled ? 'Ligada' : 'Desligada'}
                      </span>
                    </td>
                    <td className="muted">
                      {account.lastSyncAt ? account.lastSyncAt.toLocaleString('pt-BR') : 'nunca'}
                    </td>
                    <td>
                      <span className={`pill ${statusTone[account.status] ?? ''}`}>{account.status}</span>
                    </td>
                    {podeMexer ? (
                      <td>
                        {destinos.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <form className="form--inline" action={moverConta}>
                            <input type="hidden" name="clientId" value={client.id} />
                            <input type="hidden" name="accountId" value={account.id} />
                            <select className="select select--compacto" name="destinoId" defaultValue="">
                              <option value="" disabled>
                                escolher cliente
                              </option>
                              {destinos.map((destino) => (
                                <option key={destino.id} value={destino.id}>
                                  {destino.name}
                                </option>
                              ))}
                            </select>
                            <button className="btn btn--compacto" type="submit">
                              Mover
                            </button>
                          </form>
                        )}
                      </td>
                    ) : null}
                    {podeMexer ? (
                      <td>
                        <form className="form--inline" action={desvincularContaDeAnuncio}>
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="accountId" value={account.id} />
                          <button className="btn btn--compacto" type="submit" aria-label={`Desvincular ${account.name}`}>
                            Desvincular
                          </button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">Fontes de dados</span>
          <span className="card__sub">
            {fontes.length === 0
              ? 'Nenhuma propriedade, site, canal, contêiner ou local vinculado'
              : `${fontes.length} vinculada(s) · entram na coleta junto com as contas de anúncio`}
          </span>
        </div>
        {fontes.length === 0 ? (
          <div className="empty">
            GA4, Search Console, YouTube, Tag Manager e Perfil da Empresa aparecem aqui depois de
            vinculados ao cliente. É o vínculo que dá dono ao dado coletado.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Fonte</th>
                  <th>Plataforma</th>
                  <th>Tipo</th>
                  {podeMexer ? <th>Mover para</th> : null}
                  {podeMexer ? <th aria-label="Desvincular" /> : null}
                </tr>
              </thead>
              <tbody>
                {fontes.map((fonte) => (
                  <tr key={fonte.id}>
                    <td>
                      <div className="strong">{fonte.name}</div>
                      <div className="mono subtle">{fonte.externalId}</div>
                    </td>
                    <td>{ROTULO_DA_PLATAFORMA[fonte.platform]}</td>
                    <td className="muted">
                      {temRecursoParaVincular(fonte.platform) ? ROTULO_DO_RECURSO[fonte.platform] : '—'}
                    </td>
                    {podeMexer ? (
                      <td>
                        {destinosAtivos.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <form className="form--inline" action={moverFonte}>
                            <input type="hidden" name="clientId" value={client.id} />
                            <input type="hidden" name="recursoId" value={fonte.id} />
                            <select
                              className="select select--compacto"
                              name="destinoId"
                              defaultValue=""
                              required
                              aria-label={`Cliente que passa a ser dono de ${fonte.name}`}
                            >
                              <option value="" disabled>
                                escolher cliente
                              </option>
                              {destinosAtivos.map((destino) => (
                                <option key={destino.id} value={destino.id}>
                                  {destino.name}
                                </option>
                              ))}
                            </select>
                            <button className="btn btn--compacto" type="submit">
                              Mover
                            </button>
                          </form>
                        )}
                      </td>
                    ) : null}
                    {podeMexer ? (
                      <td>
                        <form className="form--inline" action={desvincularFonte}>
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="recursoId" value={fonte.id} />
                          <button className="btn btn--compacto" type="submit">
                            Desvincular
                          </button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {podeMexer ? (
          <div className="card__foot">
            <Link className="btn btn--pill" href={`/clientes/${client.id}/contas/nova`}>
              Vincular conta ou fonte →
            </Link>
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">Convites de integração</span>
          <span className="card__sub">
            Três jeitos de pedir acesso sem logar como o cliente.
          </span>
        </div>

        {podeAdministrar ? (
          <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div className="strong">Link de convite</div>
              <p className="subtle" style={{ margin: '4px 0 10px' }}>
                Cobre todas as plataformas OAuth, inclusive Google Ads e Meta Ads quando o cliente
                prefere autorizar direto, sem passar pela administradora ou pelo Business Manager.
                O cliente abre o link, autoriza com a própria conta, e nada disso passa pela sua sessão.
              </p>
              <Link className="btn btn--primary btn--pill" href={`/clientes/${client.id}/convite/novo`}>
                Convite de integração
              </Link>
            </div>

            <div>
              <div className="strong">Google Ads · administradora (MCC)</div>
              <p className="subtle" style={{ margin: '4px 0 10px' }}>
                Em vez de link, convide a conta de anúncio do cliente pela sua administradora: ela
                entra na fila, o dono da conta aceita direto no Google Ads dele, sem OAuth nenhum com
                a Orla. Depois é só vincular a conta a este cliente em “Conectar conta”.
              </p>
              {conexaoGoogle ? (
                <Link className="btn btn--pill" href={`/integracoes/${conexaoGoogle.id}`}>
                  Ver conexão do Google Ads →
                </Link>
              ) : (
                <span className="subtle">Autorize o Google Ads com uma conta administradora primeiro.</span>
              )}
            </div>

            <div>
              <div className="strong">Meta Ads · parceiro do Business Manager</div>
              <p className="subtle" style={{ margin: '4px 0 10px' }}>
                Pede acesso à conta de anúncio do cliente usando a credencial Meta já conectada da
                agência. O cliente aceita dentro do próprio Gerenciador de Negócios, sem OAuth
                nenhum com a Orla. Informe o identificador da conta (formato act_1234567890).
              </p>
              {temConexaoMeta && temBusinessManager ? (
                <form action={pedirAcessoMetaPartner} className="form--inline">
                  <input type="hidden" name="clientId" value={client.id} />
                  <input
                    className="input input--compacto"
                    name="contaDeAnuncio"
                    placeholder="act_1234567890"
                    required
                  />
                  <button className="btn btn--pill" type="submit">
                    Pedir acesso Meta Partner
                  </button>
                </form>
              ) : (
                <span className="subtle">
                  Autorize o Meta Ads com uma conta administradora do Business Manager para liberar o
                  pedido de acesso parceiro.
                </span>
              )}
            </div>
          </div>
        ) : null}

        {convites.length === 0 && pedidosDePartner.length === 0 ? (
          <div className="empty">Nenhum convite ainda.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Caminho</th>
                  <th>Plataforma</th>
                  <th>Estado</th>
                  <th>Criado em</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {convites.flatMap((convite) =>
                  convite.items.map((item) => (
                    <tr key={item.id}>
                      <td className="muted">Link de convite</td>
                      <td>{ROTULO_DA_PLATAFORMA[item.platform]}</td>
                      <td>
                        <span className={`pill ${item.status === 'completed' ? 'pill--ok' : ''}`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="muted">{convite.createdAt.toLocaleString('pt-BR')}</td>
                      <td>
                        {podeAdministrar && item.status === 'pending' && convite.status === 'pending' ? (
                          <span className="form--inline" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span className="mono subtle" title={`${baseUrl}/convite/${convite.token}`}>
                              {baseUrl}/convite/{convite.token}
                            </span>
                            <CopyButton texto={`${baseUrl}/convite/${convite.token}`} />
                          </span>
                        ) : null}
                        {podeAdministrar && convite.status === 'pending' ? (
                          <form action={revogarConviteDeIntegracao} className="form--inline">
                            <input type="hidden" name="clientId" value={client.id} />
                            <input type="hidden" name="inviteId" value={convite.id} />
                            <button className="btn btn--compacto" type="submit">
                              Revogar convite
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  )),
                )}
                {pedidosDePartner.map((pedido) => (
                  <tr key={pedido.id}>
                    <td className="muted">Pedido Meta Partner</td>
                    <td className="mono">{pedido.targetExternalId}</td>
                    <td>
                      <span
                        className={`pill ${
                          pedido.status === 'done'
                            ? 'pill--ok'
                            : pedido.status === 'failed'
                              ? 'pill--danger'
                              : 'pill--info'
                        }`}
                      >
                        {pedido.status}
                      </span>
                    </td>
                    <td className="muted">{pedido.createdAt.toLocaleString('pt-BR')}</td>
                    <td className="subtle">{pedido.outcome ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
