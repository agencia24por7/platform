import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { currentOrganization } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

const statusTone: Record<string, string> = {
  linked: 'pill--ok',
  pending: 'pill--warn',
  error: 'pill--danger',
  unlinked: 'pill',
};

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const organization = await currentOrganization();
  if (!organization) redirect('/organizacoes/nova');

  const { id } = await params;
  const found = await modules().clients.byId(organization.id, id);
  if (!found.ok) notFound();

  const client = found.value;
  const accounts = await modules().connections.listAccountsByClient(organization.id, client.id);

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
