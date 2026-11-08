import { sql } from '@/shared/db/client';
import { withTenant, withoutTenant } from '@/shared/db/tenant';
import { redact } from '@/shared/logging/redact';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { AuditEntry, AuditEvent } from '@/modules/audit/domain/auditEvent';

type Row = {
  id: string;
  organization_id: string | null;
  occurred_at: Date;
  actor_type: AuditEntry['actorType'];
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  request_id: string | null;
  source_ip: string | null;
  metadata: Record<string, unknown>;
};

function toEntry(row: Row): AuditEntry {
  return {
    id: String(row.id),
    organizationId: row.organization_id,
    occurredAt: row.occurred_at,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type ?? undefined,
    targetId: row.target_id ?? undefined,
    requestId: row.request_id ?? undefined,
    sourceIp: row.source_ip,
    metadata: row.metadata,
  };
}

export function createAuditRepository(): AuditRecorder {
  return {
    async record(event: AuditEvent): Promise<void> {
      const metadata = JSON.stringify(redact(event.metadata ?? {}));
      const insert = async (tx: ReturnType<typeof sql>) => {
        await tx`
          INSERT INTO audit.audit_log
            (organization_id, actor_type, actor_id, action, target_type, target_id, request_id, source_ip, metadata)
          VALUES (
            ${event.organizationId}, ${event.actorType}, ${event.actorId}, ${event.action},
            ${event.targetType ?? null}, ${event.targetId ?? null}, ${event.requestId ?? null},
            ${event.sourceIp ?? null}, ${metadata}::jsonb
          )`;
      };

      if (event.organizationId) await withTenant(event.organizationId, insert);
      else await withoutTenant(insert);
    },

    async list(organizationId: string, limit: number): Promise<readonly AuditEntry[]> {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT id, organization_id, occurred_at, actor_type, actor_id, action,
                 target_type, target_id, request_id, host(source_ip) AS source_ip, metadata
          FROM audit.audit_log
          WHERE organization_id = ${organizationId}
          ORDER BY occurred_at DESC
          LIMIT ${limit}`) as unknown as Row[];
        return rows.map(toEntry);
      });
    },
  };
}
