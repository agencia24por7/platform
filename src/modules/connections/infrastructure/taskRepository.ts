import { withTenant, withoutTenant } from '@/shared/db/tenant';

export type AccountTask = {
  readonly id: string;
  readonly kind: 'mcc_invite' | 'mcc_accept';
  readonly managerExternalId: string;
  readonly targetExternalId: string;
  readonly status: 'pending' | 'running' | 'done' | 'failed';
  readonly outcome: string | null;
  readonly attempts: number;
  readonly createdAt: Date;
};

export type ClaimedTask = {
  readonly taskId: string;
  readonly organizationId: string;
  readonly kind: string;
  readonly managerExternalId: string;
  readonly targetExternalId: string;
  readonly credentialRef: string;
  readonly platform: string;
};

type Row = {
  id: string;
  kind: AccountTask['kind'];
  manager_external_id: string;
  target_external_id: string;
  status: AccountTask['status'];
  outcome: string | null;
  attempts: number;
  created_at: Date;
};

const toTask = (row: Row): AccountTask => ({
  id: row.id,
  kind: row.kind,
  managerExternalId: row.manager_external_id,
  targetExternalId: row.target_external_id,
  status: row.status,
  outcome: row.outcome,
  attempts: row.attempts,
  createdAt: row.created_at,
});

export type TaskRepository = {
  request(input: {
    readonly organizationId: string;
    readonly connectionId: string;
    readonly kind: AccountTask['kind'];
    readonly managerExternalId: string;
    readonly targetExternalId: string;
    readonly requestedBy: string | null;
  }): Promise<AccountTask>;
  listPendentes(organizationId: string): Promise<readonly (AccountTask & { connectionId: string })[]>;
  listByConnection(organizationId: string, connectionId: string): Promise<readonly AccountTask[]>;
  claim(limit: number): Promise<readonly ClaimedTask[]>;
  report(taskId: string, sucesso: boolean, outcome: string): Promise<string | null>;
};

export function createTaskRepository(): TaskRepository {
  return {
    async request(input) {
      return withTenant(input.organizationId, async (tx) => {
        const rows = (await tx`
          INSERT INTO automation.account_tasks
            (organization_id, connection_id, kind, manager_external_id, target_external_id, requested_by)
          VALUES (${input.organizationId}, ${input.connectionId}, ${input.kind},
                  ${input.managerExternalId}, ${input.targetExternalId}, ${input.requestedBy})
          ON CONFLICT (connection_id, kind, target_external_id) DO UPDATE
            SET status = 'pending', attempts = 0, outcome = NULL
          RETURNING *`) as unknown as Row[];
        return toTask(rows[0]!);
      });
    },

    async listPendentes(organizationId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT *, connection_id FROM automation.account_tasks
          WHERE status IN ('pending', 'running', 'failed')
          ORDER BY created_at DESC
          LIMIT 50`) as unknown as (Row & { connection_id: string })[];
        return rows.map((row) => ({ ...toTask(row), connectionId: row.connection_id }));
      });
    },

    async listByConnection(organizationId, connectionId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM automation.account_tasks
          WHERE connection_id = ${connectionId}
          ORDER BY created_at DESC
          LIMIT 50`) as unknown as Row[];
        return rows.map(toTask);
      });
    },

    async claim(limit) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT * FROM automation.task_queue(${limit})
        `) as unknown as {
          task_id: string;
          organization_id: string;
          kind: string;
          manager_external_id: string;
          target_external_id: string;
          credential_ref: string;
          platform: string;
        }[];

        return rows.map((row) => ({
          taskId: row.task_id,
          organizationId: row.organization_id,
          kind: row.kind,
          managerExternalId: row.manager_external_id,
          targetExternalId: row.target_external_id,
          credentialRef: row.credential_ref,
          platform: row.platform,
        }));
      });
    },

    async report(taskId, sucesso, outcome) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT automation.task_result(${taskId}, ${sucesso}, ${outcome}) AS status
        `) as unknown as { status: string | null }[];
        return rows[0]?.status ?? null;
      });
    },
  };
}
