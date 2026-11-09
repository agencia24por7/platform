import { sql } from '@/shared/db/client';
import { withTenant } from '@/shared/db/tenant';
import type { CloseRunInput, OpenRunInput, QueueEntry, SyncRun } from '@/modules/ingestion/domain/syncRun';

type QueueRow = {
  ad_account_id: string;
  organization_id: string;
  client_id: string;
  client_name: string;
  platform: QueueEntry['platform'];
  external_id: string;
  login_customer_id: string | null;
  account_name: string;
  currency: string;
  timezone: string;
  credential_ref: string;
  connection_id: string;
  window_start: Date;
  window_end: Date;
  last_sync_at: Date | null;
};

type RunRow = {
  id: string;
  organization_id: string;
  ad_account_id: string;
  workflow: string;
  status: SyncRun['status'];
  window_start: Date;
  window_end: Date;
  started_at: Date;
  finished_at: Date | null;
  duration_ms: number | null;
  rows_received: number;
  rows_written: number;
  rows_restated: number;
  request_count: number;
  api_version: string | null;
  error_code: string | null;
  error_message: string | null;
  n8n_execution_id: string | null;
  client_name?: string;
  account_name?: string;
};

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

const toRun = (row: RunRow): SyncRun => ({
  id: row.id,
  organizationId: row.organization_id,
  adAccountId: row.ad_account_id,
  workflow: row.workflow,
  status: row.status,
  window: { start: isoDate(row.window_start), end: isoDate(row.window_end) },
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  durationMs: row.duration_ms,
  rowsReceived: row.rows_received,
  rowsWritten: row.rows_written,
  rowsRestated: row.rows_restated,
  requestCount: row.request_count,
  apiVersion: row.api_version,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  n8nExecutionId: row.n8n_execution_id,
});

export type SyncRunRepository = {
  queue(limit: number, rewindowDays: number): Promise<readonly QueueEntry[]>;
  findAccountOrganization(adAccountId: string): Promise<string | null>;
  findRunOrganization(runId: string): Promise<string | null>;
  open(organizationId: string, input: OpenRunInput): Promise<SyncRun>;
  findByIdempotencyKey(key: string): Promise<SyncRun | null>;
  findById(organizationId: string, id: string): Promise<SyncRun | null>;
  close(organizationId: string, input: CloseRunInput): Promise<SyncRun | null>;
  addCounters(organizationId: string, runId: string, received: number, written: number, restated: number): Promise<void>;
  recent(organizationId: string, limit: number): Promise<readonly (SyncRun & { clientName: string; accountName: string })[]>;
};

export function createSyncRunRepository(): SyncRunRepository {
  return {
    async queue(limit, rewindowDays) {
      const rows = (await sql()`
        SELECT * FROM automation.sync_queue(${limit}, ${rewindowDays})`) as unknown as QueueRow[];
      return rows.map((row) => ({
        adAccountId: row.ad_account_id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        clientName: row.client_name,
        platform: row.platform,
        externalId: row.external_id,
        loginCustomerId: row.login_customer_id,
        accountName: row.account_name,
        currency: row.currency,
        timezone: row.timezone,
        credentialRef: row.credential_ref,
        connectionId: row.connection_id,
        window: { start: isoDate(row.window_start), end: isoDate(row.window_end) },
        lastSyncAt: row.last_sync_at,
      }));
    },

    async findAccountOrganization(adAccountId) {
      const rows = (await sql()`
        SELECT organization_id, sync_enabled, account_status, client_status
        FROM automation.resolve_account_organization(${adAccountId})`) as unknown as {
        organization_id: string;
        sync_enabled: boolean;
        account_status: string;
        client_status: string;
      }[];
      const found = rows[0];
      if (!found || !found.sync_enabled || found.account_status !== 'linked') return null;
      if (found.client_status !== 'active') return null;
      return found.organization_id;
    },

    async findRunOrganization(runId) {
      const rows = (await sql()`
        SELECT organization_id FROM automation.resolve_run_organization(${runId})`) as unknown as {
        organization_id: string;
      }[];
      return rows[0]?.organization_id ?? null;
    },

    async open(organizationId, input) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          INSERT INTO automation.sync_runs
            (organization_id, ad_account_id, workflow, trigger_source, idempotency_key,
             window_start, window_end, api_version, n8n_execution_id)
          VALUES (${organizationId}, ${input.adAccountId}, ${input.workflow}, ${input.triggerSource},
                  ${input.idempotencyKey}, ${input.window.start}, ${input.window.end},
                  ${input.apiVersion}, ${input.n8nExecutionId})
          RETURNING *`) as unknown as RunRow[];
        return toRun(rows[0]!);
      });
    },

    async findByIdempotencyKey(key) {
      const rows = (await sql()`
        SELECT organization_id, run_id FROM automation.resolve_run_by_key(${key})`) as unknown as {
        organization_id: string;
        run_id: string;
      }[];
      const found = rows[0];
      if (!found) return null;

      return withTenant(found.organization_id, async (tx) => {
        const runRows = (await tx`
          SELECT * FROM automation.sync_runs WHERE id = ${found.run_id}`) as unknown as RunRow[];
        return runRows[0] ? toRun(runRows[0]) : null;
      });
    },

    async findById(organizationId, id) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`SELECT * FROM automation.sync_runs WHERE id = ${id}`) as unknown as RunRow[];
        return rows[0] ? toRun(rows[0]) : null;
      });
    },

    async close(organizationId, input) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE automation.sync_runs
          SET status = ${input.status}::automation.run_status,
              finished_at = now(),
              duration_ms = (extract(epoch FROM (now() - started_at)) * 1000)::int,
              request_count = ${input.requestCount},
              api_version = coalesce(${input.apiVersion}, api_version),
              error_code = ${input.errorCode},
              error_message = ${input.errorMessage}
          WHERE id = ${input.runId} AND status = 'running'
          RETURNING *`) as unknown as RunRow[];
        return rows[0] ? toRun(rows[0]) : null;
      });
    },

    async addCounters(organizationId, runId, received, written, restated) {
      await withTenant(organizationId, async (tx) => {
        await tx`
          UPDATE automation.sync_runs
          SET rows_received = rows_received + ${received},
              rows_written = rows_written + ${written},
              rows_restated = rows_restated + ${restated}
          WHERE id = ${runId}`;
      });
    },

    async recent(organizationId, limit) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT r.*, c.name AS client_name, a.name AS account_name
          FROM automation.sync_runs r
          JOIN integrations.ad_accounts a ON a.id = r.ad_account_id
          JOIN core.clients c ON c.id = a.client_id
          ORDER BY r.started_at DESC
          LIMIT ${limit}`) as unknown as RunRow[];
        return rows.map((row) => ({
          ...toRun(row),
          clientName: row.client_name ?? '',
          accountName: row.account_name ?? '',
        }));
      });
    },
  };
}
