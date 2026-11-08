import { redirect } from 'next/navigation';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { currentOrganization } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

const runTone: Record<string, string> = {
  running: 'pill--info',
  success: 'pill--ok',
  partial: 'pill--warn',
  failed: 'pill--danger',
};

export default async function AutomationsPage() {
  const organization = await currentOrganization();
  if (!organization) redirect('/organizacoes/nova');

  const [runs, audit] = await Promise.all([
    modules().ingestion.recentRuns(organization.id, 25),
    modules().audit.list(organization.id, 40),
  ]);

  return (
    <Shell title="Coletas e auditoria" organization={organization} active="/automacoes">
      <div className="page__head">
        <div>
          <div className="page__title">Coletas e auditoria</div>
          <div className="page__sub">
            Cada execução registra janela, versão da API, número de chamadas, linhas recebidas, gravadas e
            reafirmadas. Nada entra sem deixar rastro.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">Execuções de coleta</span>
          <span className="card__sub">{runs.length} recente(s)</span>
        </div>
        {runs.length === 0 ? (
          <div className="empty">Nenhuma coleta ainda. Rode o workflow no n8n.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Conta</th>
                  <th>Workflow</th>
                  <th>Janela</th>
                  <th>API</th>
                  <th className="num">Chamadas</th>
                  <th className="num">Recebidas</th>
                  <th className="num">Gravadas</th>
                  <th className="num">Reafirmadas</th>
                  <th className="num">Duração</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="muted">{run.startedAt.toLocaleString('pt-BR')}</td>
                    <td>
                      <div className="strong">{run.accountName}</div>
                      <div className="subtle xsmall">{run.clientName}</div>
                    </td>
                    <td className="mono">{run.workflow}</td>
                    <td className="muted">
                      {run.window.start} → {run.window.end}
                    </td>
                    <td className="mono">{run.apiVersion ?? '—'}</td>
                    <td className="num">{run.requestCount}</td>
                    <td className="num">{run.rowsReceived}</td>
                    <td className="num">{run.rowsWritten}</td>
                    <td className="num">{run.rowsRestated}</td>
                    <td className="num">{run.durationMs ? `${run.durationMs} ms` : '—'}</td>
                    <td>
                      <span className={`pill ${runTone[run.status] ?? ''}`}>{run.status}</span>
                      {run.errorCode ? <div className="xsmall subtle">{run.errorCode}</div> : null}
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
          <span className="card__title">Trilha de auditoria</span>
          <span className="card__sub">Append-only — o app não tem permissão de UPDATE nem DELETE aqui</span>
        </div>
        {audit.length === 0 ? (
          <div className="empty">Sem eventos.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Autor</th>
                  <th>Evento</th>
                  <th>Alvo</th>
                  <th>Metadados</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((entry) => (
                  <tr key={entry.id}>
                    <td className="muted">{entry.occurredAt.toLocaleString('pt-BR')}</td>
                    <td>
                      <span className="pill">{entry.actorType}</span>
                      {entry.actorId ? <div className="mono subtle">{entry.actorId}</div> : null}
                    </td>
                    <td className="mono">{entry.action}</td>
                    <td className="muted">
                      {entry.targetType ?? '—'}
                      {entry.targetId ? <div className="mono subtle">{entry.targetId.slice(0, 8)}</div> : null}
                    </td>
                    <td className="mono">{JSON.stringify(entry.metadata)}</td>
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
