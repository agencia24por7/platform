import type { AuditEntry, AuditEvent } from '@/modules/audit/domain/auditEvent';

export type AuditRecorder = {
  record(event: AuditEvent): Promise<void>;
  list(organizationId: string, limit: number): Promise<readonly AuditEntry[]>;
};
