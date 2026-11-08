import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Readiness } from '@/../app/_components/Readiness';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { encurtarEscopo } from '@/modules/audit/domain/auditView';
import { agruparPorAdministradora } from '@/modules/connections/domain/carteira';
import { currentOrganization } from '@/shared/http/currentOrganization';
import { readinessOf } from '@/modules/connections/domain/connection';

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

  const [connections, accounts, alcancaveis] = await Promise.all([
    modules().connections.listConnections(organization.id),
    modules().connections.listAccounts(organization.id),
    modules().discoveredAccounts.listAll(organization.id),
  ]);

  const caminhos = agruparPorAdministradora(alcancaveis);
  const porExternalId = new Map(accounts.map((conta) => [conta.externalId, conta]));

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
                  <th>Conta que concedeu</th>
                  <th>Concedida em</th>
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
                      <Link className="strong" href={`/integracoes/${connection.id}`}>
                        {connection.label}
                      </Link>
                      <div className="mono subtle">{connection.externalId}</div>
                    </td>
                    <td>{connection.platform === 'meta' ? 'Meta Ads' : 'Google Ads'}</td>
                    <td>
                      {connection.accountEmail ?? <span className="subtle">não informado</span>}
                    </td>
                    <td className="nowrap">
                      <div>{connection.authorizedAt.toLocaleDateString('pt-BR')}</div>
                      <div className="subtle">
                        {connection.authorizedAt.toLocaleTimeString('pt-BR')}
                      </div>
                    </td>
                    <td className="muted">{grantLabel[connection.grantType]}</td>
                    <td>
                      <div className="fichas">
                        {connection.scopes.map((scope) => (
                          <span key={scope} className="ficha" title={scope}>
                            {encurtarEscopo(scope)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="mono">
                      {readinessOf(connection).collectable ? 'cofre · ok' : 'sem credencial'}
                    </td>
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
          <span className="card__title">Contas que você alcança</span>
          <span className="card__sub">
            {alcancaveis.length} conta(s) em {caminhos.length} caminho(s) de acesso
          </span>
        </div>

        {caminhos.length === 0 ? (
          <div className="empty">
            Nenhuma conta ainda. Autorize uma plataforma para a tria enxergar o que você administra.
          </div>
        ) : (
          caminhos.map((caminho) => (
            <div key={caminho.administradora ?? 'direto'} className="caminho">
              <div className="caminho__topo">
                {caminho.administradora ? (
                  <>
                    <span className="pill pill--info">MCC</span>
                    <span className="mono strong">{caminho.administradora}</span>
                    <span className="subtle">administradora — não veicula campanha</span>
                  </>
                ) : (
                  <>
                    <span className="pill">direto</span>
                    <span className="subtle">contas suas, sem administradora no caminho</span>
                  </>
                )}
                <span className="caminho__contagem">
                  {caminho.vinculadas} vinculada(s) · {caminho.disponiveis} disponível(is)
                </span>
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Conta</th>
                      <th>Identificador</th>
                      <th>Moeda</th>
                      <th>Cliente</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {caminho.contas.map((conta) => {
                      const vinculada = porExternalId.get(conta.externalId);

                      return (
                        <tr key={conta.id}>
                          <td>
                            <div className="strong">{conta.name}</div>
                            {conta.inactive ? (
                              <span className="pill pill--warn">inativa na plataforma</span>
                            ) : null}
                          </td>
                          <td className="mono">{conta.externalId}</td>
                          <td>{conta.currency}</td>
                          <td>
                            {vinculada ? (
                              vinculada.clientName
                            ) : (
                              <span className="subtle">nenhum cliente</span>
                            )}
                          </td>
                          <td>
                            <span className={`pill ${conta.state === 'linked' ? 'pill--ok' : ''}`}>
                              {conta.state === 'linked' ? 'vinculada' : 'disponível'}
                            </span>
                          </td>
                          <td>
                            {conta.state !== 'linked' && !conta.inactive ? (
                              <Link className="btn btn--pill" href="/clientes">
                                Vincular a um cliente →
                              </Link>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
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
