import type { AuditEntry, AuditEvent } from '@/modules/audit/domain/auditEvent';

export type AuditFilter = {
  readonly action?: string | null;
  readonly family?: string | null;
  readonly actorType?: string | null;
  readonly since?: Date | null;
  readonly limit: number;
};

export type AuditRecorder = {
  record(event: AuditEvent): Promise<void>;
  list(organizationId: string, limit: number): Promise<readonly AuditEntry[]>;
  search(organizationId: string, filtro: AuditFilter): Promise<readonly AuditEntry[]>;
};
