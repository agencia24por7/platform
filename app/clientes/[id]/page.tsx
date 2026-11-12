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
import { ROTULO_DA_PLATAFORMA } from '@/modules/connections/domain/connection';
import { pedirAcessoMetaPartner, revogarConviteDeIntegracao } from '@/../app/clientes/[id]/acoes';

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
  const [accounts, irmaos, convites, pedidosDePartner, organizacao, conexoes] = await Promise.all([
    modules().connections.listAccountsByClient(organization.id, client.id),
    modules().clients.list(organization.id),
    modules().connectionInvites.listByClient(organization.id, client.id),
    modules().tasks.listByClient(organization.id, client.id),
    modules().organizations.byId(organization.id),
    modules().connections.listConnections(organization.id),
  ]);
  const podeMexer = canOperate(ctx.role);
  const podeAdministrar = canAdminister(ctx.role);
  const destinos = irmaos.filter((item) => item.id !== client.id);
  const temConexaoMeta = conexoes.some(
    (conexao) => conexao.platform === 'meta' && conexao.grantType === 'oauth_user',
  );
  const temBusinessManager = organizacao.ok && Boolean(organizacao.value.businessManagerId);
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
        <span className={accounts.length > 0 ? 'step step--done' : 'step step--active'}>
          2 · Contas de anúncio
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">Convites de integração</span>
          <span className="card__sub">
            Dois jeitos de pedir acesso sem logar como o cliente: link para ele autorizar, ou pedido
            direto ao Business Manager do Meta.
          </span>
        </div>

        {podeAdministrar ? (
          <div className="card__body" style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
            <Link className="btn btn--primary btn--pill" href={`/clientes/${client.id}/convite/novo`}>
              Convite de integração
            </Link>

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
                          <span className="mono subtle" title={`${baseUrl}/convite/${convite.token}`}>
                            {baseUrl}/convite/{convite.token}
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
