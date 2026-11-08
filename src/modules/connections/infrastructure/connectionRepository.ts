import { withTenant } from '@/shared/db/tenant';
import type { Connection, NewConnection } from '@/modules/connections/domain/connection';

type Row = {
  id: string;
  organization_id: string;
  platform: Connection['platform'];
  grant_type: Connection['grantType'];
  label: string;
  external_id: string;
  scopes: string[];
  credential_ref: string;
  status: Connection['status'];
  expires_at: Date | null;
  authorized_at: Date;
};

const toConnection = (row: Row): Connection => ({
  id: row.id,
  organizationId: row.organization_id,
  platform: row.platform,
  grantType: row.grant_type,
  label: row.label,
  externalId: row.external_id,
  scopes: row.scopes,
  credentialRef: row.credential_ref,
  status: row.status,
  expiresAt: row.expires_at,
  authorizedAt: row.authorized_at,
});

export type ConnectionRepository = {
  insert(input: NewConnection): Promise<Connection>;
  findById(organizationId: string, id: string): Promise<Connection | null>;
  findByExternalId(organizationId: string, platform: string, externalId: string): Promise<Connection | null>;
  renew(input: NewConnection & { readonly id: string }): Promise<Connection>;
  list(organizationId: string): Promise<readonly Connection[]>;
};

export function createConnectionRepository(): ConnectionRepository {
  return {
    async insert(input) {
      return withTenant(input.organizationId, async (tx) => {
        const rows = (await tx`
          INSERT INTO integrations.connections
            (organization_id, platform, grant_type, label, external_id, scopes, credential_ref, expires_at, status)
          VALUES (${input.organizationId}, ${input.platform}, ${input.grantType}, ${input.label},
                  ${input.externalId}, ${tx.array(input.scopes as string[])}, ${input.credentialRef}, ${input.expiresAt}, ${input.status ?? 'active'})
          RETURNING *`) as unknown as Row[];
        return toConnection(rows[0]!);
      });
    },

    async renew(input) {
      return withTenant(input.organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE integrations.connections
          SET label          = ${input.label},
              scopes         = ${tx.array(input.scopes as string[])},
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
  };
}
