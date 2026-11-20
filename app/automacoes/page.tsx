import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Shell } from '@/../app/_components/Shell';
import { modules } from '@/composition';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { resolverAlertasDaPlataforma } from '@/../app/automacoes/acoes';
import { canAdminister } from '@/modules/identity/domain/user';
import { requireContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

const runTone: Record<string, string> = {
  running: 'pill--info',
  success: 'pill--ok',
  partial: 'pill--warn',
  failed: 'pill--danger',
};

export default async function AutomationsPage() {
  const contexto = await requireContext();
  const organization = contexto.organization;
  const administra = canAdminister(contexto.role);

  const runs = await modules().ingestion.recentRuns(organization.id, 25);
  const alertasAbertos = administra ? await modules().alertas.contarAbertos() : 0;

  return (
    <Shell title="Coletas" organization={organization} active="/automacoes">
      <div className="page__head">
        <div>
          <h1 className="page__title">Coletas</h1>
          <div className="page__sub">
            Cada execução registra janela, versão da API, número de chamadas, linhas recebidas, gravadas e
            reafirmadas. Nada entra sem deixar rastro.
          </div>
        </div>
        {alertasAbertos > 0 ? (
          <form action={resolverAlertasDaPlataforma}>
            <span className="pill pill--danger">{alertasAbertos} alerta(s) de falha da plataforma</span>{' '}
            <BotaoDeEnvio className="btn" pendente="Resolvendo…">
              Marcar como resolvidos
            </BotaoDeEnvio>
          </form>
        ) : null}
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

      <p className="quiet-link">
        Os eventos de auditoria ganharam tela própria, com filtros e cada metadado em coluna:{' '}
        <Link href="/auditoria">ver a trilha completa →</Link>
      </p>

    </Shell>
  );
}
