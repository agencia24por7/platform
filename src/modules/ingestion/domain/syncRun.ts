export type RunStatus = 'running' | 'success' | 'partial' | 'failed';

export type SyncWindow = { readonly start: string; readonly end: string };

export type QueueEntry = {
  readonly adAccountId: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly platform: 'meta' | 'google';
  readonly externalId: string;
  readonly loginCustomerId: string | null;
  readonly accountName: string;
  readonly currency: string;
  readonly timezone: string;
  readonly connectionId: string;
  readonly temToken: boolean;
  readonly window: SyncWindow;
  readonly lastSyncAt: Date | null;
};

export type SyncRun = {
  readonly id: string;
  readonly organizationId: string;
  readonly adAccountId: string;
  readonly workflow: string;
  readonly status: RunStatus;
  readonly window: SyncWindow;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly durationMs: number | null;
  readonly rowsReceived: number;
  readonly rowsWritten: number;
  readonly rowsRestated: number;
  readonly requestCount: number;
  readonly apiVersion: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly n8nExecutionId: string | null;
};

export type OpenRunInput = {
  readonly adAccountId: string;
  readonly workflow: string;
  readonly triggerSource: string;
  readonly idempotencyKey: string;
  readonly window: SyncWindow;
  readonly apiVersion: string | null;
  readonly n8nExecutionId: string | null;
};

export type CloseRunInput = {
  readonly runId: string;
  readonly status: Exclude<RunStatus, 'running'>;
  readonly requestCount: number;
  readonly apiVersion: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
};

export function isWindowSane(window: SyncWindow, maxDays: number): boolean {
  const start = Date.parse(`${window.start}T00:00:00Z`);
  const end = Date.parse(`${window.end}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return false;
  return (end - start) / 86_400_000 <= maxDays;
}
