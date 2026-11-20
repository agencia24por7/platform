import { withTenant } from '@/shared/db/tenant';
import type { Connection, NewConnection } from '@/modules/connections/domain/connection';

export type WorkflowsDaConexao = {
  readonly coletorRef: string | null;
  readonly executorRef: string | null;
};

type Row = {
  id: string;
  organization_id: string;
  platform: Connection['platform'];
  grant_type: Connection['grantType'];
  label: string;
  external_id: string;
  account_email: string | null;
  scopes: string[];
  credential_ref: string;
  status: Connection['status'];
  expires_at: Date | null;
  authorized_at: Date;
  webhook_token: string | null;
  authorized_via: Connection['authorizedVia'];
};

const toConnection = (row: Row): Connection => ({
  id: row.id,
  organizationId: row.organization_id,
  platform: row.platform,
  grantType: row.grant_type,
  label: row.label,
  externalId: row.external_id,
  accountEmail: row.account_email,
  scopes: row.scopes,
  credentialRef: row.credential_ref,
  status: row.status,
  expiresAt: row.expires_at,
  authorizedAt: row.authorized_at,
  webhookToken: row.webhook_token,
  authorizedVia: row.authorized_via,
});

export type ConnectionRepository = {
  insert(input: NewConnection): Promise<Connection>;
  findById(organizationId: string, id: string): Promise<Connection | null>;
  findByExternalId(organizationId: string, platform: string, externalId: string): Promise<Connection | null>;
  renew(input: NewConnection & { readonly id: string }): Promise<Connection>;
  list(organizationId: string): Promise<readonly Connection[]>;
  revogar(organizationId: string, id: string): Promise<WorkflowsDaConexao | null>;
  trocarColetorRef(organizationId: string, id: string, coletorRef: string): Promise<string | null>;
  trocarExecutorRef(organizationId: string, id: string, executorRef: string): Promise<string | null>;
};

export function createConnectionRepository(): ConnectionRepository {
  return {
    async insert(input) {
      return withTenant(input.organizationId, async (tx) => {
        const rows = (await tx`
          INSERT INTO integrations.connections
            (organization_id, platform, grant_type, label, external_id, account_email, scopes, credential_ref, expires_at, status, webhook_token, authorized_via)
          VALUES (${input.organizationId}, ${input.platform}, ${input.grantType}, ${input.label},
                  ${input.externalId}, ${input.accountEmail ?? null}, ${input.scopes as string[]}::text[], ${input.credentialRef}, ${input.expiresAt}, ${input.status ?? 'active'}, ${input.webhookToken ?? null}, ${input.authorizedVia})
          RETURNING *`) as unknown as Row[];
        return toConnection(rows[0]!);
      });
    },

    async renew(input) {
      return withTenant(input.organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE integrations.connections
          SET label          = ${input.label},
              account_email  = ${input.accountEmail ?? null},
              scopes         = ${input.scopes as string[]}::text[],
              credential_ref = ${input.credentialRef},
              status         = ${input.status ?? 'active'},
              expires_at     = ${input.expiresAt},
              authorized_at  = now()
          WHERE id = ${input.id}
          RETURNING *`) as unknown as Row[];
        return toConnection(rows[0]!);
      });
    },

    async findById(organizationId, id) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`SELECT * FROM integrations.connections WHERE id = ${id}`) as unknown as Row[];
        return rows[0] ? toConnection(rows[0]) : null;
      });
    },

    async findByExternalId(organizationId, platform, externalId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM integrations.connections
          WHERE platform = ${platform}::integrations.platform AND external_id = ${externalId}`) as unknown as Row[];
        return rows[0] ? toConnection(rows[0]) : null;
      });
    },

    async list(organizationId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM integrations.connections ORDER BY authorized_at DESC`) as unknown as Row[];
        return rows.map(toConnection);
      });
    },

    async revogar(organizationId, id) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          WITH antes AS (
            SELECT id, coletor_ref, executor_ref FROM integrations.connections
            WHERE id = ${id} AND status <> 'revoked'
            FOR UPDATE
          )
          UPDATE integrations.connections c
          SET status         = 'revoked',
              credential_ref = 'descartada',
              account_email  = NULL,
              webhook_token  = NULL,
              coletor_ref    = NULL,
              executor_ref   = NULL
          FROM antes
          WHERE c.id = antes.id
          RETURNING antes.coletor_ref, antes.executor_ref`) as unknown as {
          coletor_ref: string | null;
          executor_ref: string | null;
        }[];
        const linha = rows[0];
        return linha ? { coletorRef: linha.coletor_ref, executorRef: linha.executor_ref } : null;
      });
    },

    async trocarColetorRef(organizationId, id, coletorRef) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE integrations.connections novo
          SET coletor_ref = ${coletorRef}
          FROM (SELECT coletor_ref FROM integrations.connections WHERE id = ${id} FOR UPDATE) anterior
          WHERE novo.id = ${id}
          RETURNING anterior.coletor_ref AS anterior`) as unknown as { anterior: string | null }[];
        return rows[0]?.anterior ?? null;
      });
    },

    async trocarExecutorRef(organizationId, id, executorRef) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE integrations.connections novo
          SET executor_ref = ${executorRef}
          FROM (SELECT executor_ref FROM integrations.connections WHERE id = ${id} FOR UPDATE) anterior
          WHERE novo.id = ${id}
          RETURNING anterior.executor_ref AS anterior`) as unknown as { anterior: string | null }[];
        return rows[0]?.anterior ?? null;
      });
    },
  };
}
