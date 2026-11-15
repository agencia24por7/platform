import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { AdAccountRepository } from '@/modules/connections/infrastructure/adAccountRepository';
import { isCoherent, type MetricRow } from '@/modules/ingestion/domain/metricRow';
import {
  isWindowSane,
  type CloseRunInput,
  type OpenRunInput,
  type QueueEntry,
  type SyncRun,
} from '@/modules/ingestion/domain/syncRun';
import type { MetricsRepository } from '@/modules/ingestion/infrastructure/metricsRepository';
import type { SyncRunRepository } from '@/modules/ingestion/infrastructure/syncRunRepository';

const MAX_WINDOW_DAYS = 90;

export type WorkerIdentity = { readonly requestId: string; readonly callerFingerprint: string; readonly sourceIp: string | null };

export type IngestionService = {
  queue(limit: number, rewindowDays: number, worker: WorkerIdentity): Promise<readonly QueueEntry[]>;
  openRun(input: OpenRunInput, worker: WorkerIdentity): Promise<Result<SyncRun, Failure>>;
  ingest(
    runId: string,
    rows: readonly MetricRow[],
    worker: WorkerIdentity,
  ): Promise<Result<{ received: number; written: number; restated: number; rejected: number }, Failure>>;
  closeRun(input: CloseRunInput, worker: WorkerIdentity): Promise<Result<SyncRun, Failure>>;
  recentRuns(organizationId: string, limit: number): Promise<readonly (SyncRun & { clientName: string; accountName: string })[]>;
};

export function createIngestionService(
  runs: SyncRunRepository,
  metrics: MetricsRepository,
  accounts: AdAccountRepository,
  audit: AuditRecorder,
): IngestionService {
  return {
    async queue(limit, rewindowDays, worker) {
      const entries = await runs.queue(limit, rewindowDays);
      await audit.record({
        organizationId: null,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'sync.queue.read',
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: { returned: entries.length, limit, rewindowDays },
      });
      return entries;
    },

    async openRun(input, worker) {
      if (!isWindowSane(input.window, MAX_WINDOW_DAYS)) {
        return err(failure('validation', `Janela inválida ou maior que ${MAX_WINDOW_DAYS} dias.`));
      }

      const existing = await runs.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        if (existing.adAccountId !== input.adAccountId) {
          return err(
            failure('conflict', 'Esta chave de idempotência já pertence a uma execução de outra conta.'),
          );
        }
        return ok(existing);
      }

      const organizationId = await runs.findAccountOrganization(input.adAccountId);
      if (!organizationId) return err(failure('not_found', 'Conta de anúncios não encontrada.'));

      const run = await runs.open(organizationId, input);

      await audit.record({
        organizationId,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'sync.run.open',
        targetType: 'sync_run',
        targetId: run.id,
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: {
          adAccountId: run.adAccountId,
          workflow: run.workflow,
          window: run.window,
          idempotencyKey: input.idempotencyKey,
          n8nExecutionId: input.n8nExecutionId,
        },
      });

      return ok(run);
    },

    async ingest(runId, rows, worker) {
      const run = await findRun(runs, runId);
      if (!run) return err(failure('not_found', 'Execução não encontrada.'));
      if (run.status !== 'running') return err(failure('conflict', 'Execução já encerrada.'));

      const inWindow = rows.filter(
        (row) => row.metricDate >= run.window.start && row.metricDate <= run.window.end,
      );
      const accepted = inWindow.filter(isCoherent);
      const rejected = rows.length - accepted.length;

      const outcome = await metrics.upsert(
        run.organizationId,
        run.adAccountId,
        run.id,
        run.apiVersion,
        accepted,
      );

      await runs.addCounters(run.organizationId, run.id, rows.length, outcome.written, outcome.restated);

      await audit.record({
        organizationId: run.organizationId,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'sync.metrics.ingest',
        targetType: 'sync_run',
        targetId: run.id,
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: {
          adAccountId: run.adAccountId,
          received: rows.length,
          written: outcome.written,
          restated: outcome.restated,
          rejected,
          window: run.window,
        },
      });

      return ok({ received: rows.length, written: outcome.written, restated: outcome.restated, rejected });
    },

    async closeRun(input, worker) {
      const run = await findRun(runs, input.runId);
      if (!run) return err(failure('not_found', 'Execução não encontrada.'));

      const closed = await runs.close(run.organizationId, input);
      if (!closed) return err(failure('conflict', 'Execução já encerrada.'));

      if (closed.status === 'success' || closed.status === 'partial') {
        await accounts.markSynced(run.organizationId, run.adAccountId, new Date());
      }

      await audit.record({
        organizationId: run.organizationId,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'sync.run.close',
        targetType: 'sync_run',
        targetId: closed.id,
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: {
          status: closed.status,
          durationMs: closed.durationMs,
          rowsReceived: closed.rowsReceived,
          rowsWritten: closed.rowsWritten,
          rowsRestated: closed.rowsRestated,
          requestCount: closed.requestCount,
          apiVersion: closed.apiVersion,
          errorCode: closed.errorCode,
        },
      });

      return ok(closed);
    },

    recentRuns: (organizationId, limit) => runs.recent(organizationId, limit),
  };
}

async function findRun(runs: SyncRunRepository, runId: string): Promise<SyncRun | null> {
  const organizationId = await runs.findRunOrganization(runId);
  return organizationId ? runs.findById(organizationId, runId) : null;
}
