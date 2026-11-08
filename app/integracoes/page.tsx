import { redirect } from 'next/navigation';
import { Readiness } from '@/../app/_components/Readiness';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { currentOrganization } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

const statusTone: Record<string, string> = {
  active: 'pill--ok',
  expiring: 'pill--warn',
  degraded: 'pill--warn',
  revoked: 'pill--danger',
  reauth_pending: 'pill--warn',
};

const grantLabel: Record<string, string> = {
  mcc: 'MCC da organização',
  bm_partner: 'Parceria entre BMs',
  system_user: 'Usuário do sistema',
  oauth_user: 'OAuth direto',
};

export default async function IntegrationsPage() {
  const organization = await currentOrganization();
  if (!organization) redirect('/organizacoes/nova');

  const [connections, accounts] = await Promise.all([
    modules().connections.listConnections(organization.id),
    modules().connections.listAccounts(organization.id),
  ]);

  return (
    <Shell title="Contas e conexões" organization={organization} active="/integracoes">
      <div className="page__head">
        <div>
          <div className="page__title">Contas e conexões</div>
          <div className="page__sub">
            A autorização guarda apenas metadado e uma referência de credencial. O segredo vive no n8n,
            cifrado, e nunca passa por aqui.
          </div>
        </div>
      </div>

      <Readiness connections={connections.length} linkedAccounts={accounts.length} />

      <div className="card">
        <div className="card__head">
          <span className="card__title">Autorizações</span>
          <span className="card__sub">{connections.length} registrada(s)</span>
        </div>
        {connections.length === 0 ? (
          <div className="empty">Nenhuma autorização. Crie uma ao conectar a primeira conta.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Autorização</th>
                  <th>Plataforma</th>
                  <th>Caminho</th>
                  <th>Escopos</th>
                  <th>Credencial</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((connection) => (
                  <tr key={connection.id}>
                    <td>
                      <div className="strong">{connection.label}</div>
                      <div className="mono subtle">{connection.externalId}</div>
                    </td>
                    <td>{connection.platform === 'meta' ? 'Meta Ads' : 'Google Ads'}</td>
                    <td className="muted">{grantLabel[connection.grantType]}</td>
                    <td>
                      {connection.scopes.map((scope) => (
                        <span key={scope} className="pill" style={{ marginRight: 4 }}>
                          {scope}
                        </span>
                      ))}
                    </td>
                    <td className="mono">{connection.credentialRef}</td>
                    <td>
                      <span className={`pill ${statusTone[connection.status] ?? ''}`}>
                        <span className="dot" />
                        {connection.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">Contas vinculadas</span>
          <span className="card__sub">{accounts.length} conta(s)</span>
        </div>
        {accounts.length === 0 ? (
          <div className="empty">Nenhuma conta vinculada.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Cliente</th>
                  <th>Plataforma</th>
                  <th>Coleta</th>
                  <th>Última coleta</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <div className="strong">{account.name}</div>
                      <div className="mono subtle">{account.externalId}</div>
                    </td>
                    <td className="muted">{account.clientName}</td>
                    <td>{account.platform === 'meta' ? 'Meta Ads' : 'Google Ads'}</td>
                    <td>
                      <span className={`pill ${account.syncEnabled ? 'pill--ok' : ''}`}>
                        {account.syncEnabled ? 'Ligada' : 'Desligada'}
                      </span>
                    </td>
                    <td className="muted">
                      {account.lastSyncAt ? account.lastSyncAt.toLocaleString('pt-BR') : 'nunca'}
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
