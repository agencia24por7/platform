import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Readiness } from '@/../app/_components/Readiness';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { currentOrganization } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const organization = await currentOrganization();
  if (!organization) redirect('/organizacoes/nova');

  const [clients, connections, accounts] = await Promise.all([
    modules().clients.list(organization.id),
    modules().connections.listConnections(organization.id),
    modules().connections.listAccounts(organization.id),
  ]);
  const noun = organization.type === 'advertiser' ? 'Negócios' : 'Clientes';

  return (
    <Shell title={noun} organization={organization} active="/clientes">
      <div className="page__head">
        <div>
          <div className="page__title">{noun}</div>
          <div className="page__sub">
            Rede e filial formam hierarquia de um nível. Cada cliente recebe contas de anúncio próprias,
            vinculadas a uma autorização da organização.
          </div>
        </div>
        <div className="page__actions">
          <Link className="btn btn--primary" href="/clientes/novo">
            Novo {noun === 'Negócios' ? 'negócio' : 'cliente'}
          </Link>
        </div>
      </div>

      <Readiness connections={connections.length} linkedAccounts={accounts.length} />

      <div className="card">
        {clients.length === 0 ? (
          <div className="empty">
            Nenhum cadastro ainda. Comece criando o primeiro {noun === 'Negócios' ? 'negócio' : 'cliente'}.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Segmento</th>
                  <th>Modelo</th>
                  <th className="num">Contas</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id}>
                    <td>
                      {client.parentClientId ? <span className="subtle">└ </span> : null}
                      <span className="strong">{client.name}</span>
                    </td>
                    <td className="muted">{client.segment ?? '—'}</td>
                    <td>
                      <span className={`pill ${client.businessModel === 'ecommerce' ? 'pill--info' : 'pill--ok'}`}>
                        {client.businessModel === 'ecommerce' ? 'E-commerce' : 'Leads'}
                      </span>
                    </td>
                    <td className="num">{client.accountCount}</td>
                    <td>
                      <span className="pill pill--ok">
                        <span className="dot" />
                        Ativo
                      </span>
                    </td>
                    <td>
                      <Link className="btn" href={`/clientes/${client.id}`}>
                        Abrir
                      </Link>
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
