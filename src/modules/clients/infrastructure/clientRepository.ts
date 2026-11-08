import { withTenant } from '@/shared/db/tenant';
import type { Client, ClientWithAccounts, NewClient } from '@/modules/clients/domain/client';

type Row = {
  id: string;
  organization_id: string;
  parent_client_id: string | null;
  name: string;
  segment: string | null;
  business_model: Client['businessModel'];
  status: Client['status'];
  created_at: Date;
  account_count?: string;
};

const toClient = (row: Row): Client => ({
  id: row.id,
  organizationId: row.organization_id,
  parentClientId: row.parent_client_id,
  name: row.name,
  segment: row.segment,
  businessModel: row.business_model,
  status: row.status,
  createdAt: row.created_at,
});

export type ClientRepository = {
  insert(input: NewClient): Promise<Client>;
  findById(organizationId: string, id: string): Promise<Client | null>;
  findByName(organizationId: string, name: string): Promise<Client | null>;
  list(organizationId: string): Promise<readonly ClientWithAccounts[]>;
};

export function createClientRepository(): ClientRepository {
  return {
    async insert(input) {
      return withTenant(input.organizationId, async (tx) => {
        const rows = (await tx`
          INSERT INTO core.clients (organization_id, parent_client_id, name, segment, business_model)
          VALUES (${input.organizationId}, ${input.parentClientId}, ${input.name},
                  ${input.segment}, ${input.businessModel})
          RETURNING *`) as unknown as Row[];
        return toClient(rows[0]!);
      });
    },

    async findById(organizationId, id) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`SELECT * FROM core.clients WHERE id = ${id}`) as unknown as Row[];
        return rows[0] ? toClient(rows[0]) : null;
      });
    },

    async findByName(organizationId, name) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`SELECT * FROM core.clients WHERE lower(name) = lower(${name})`) as unknown as Row[];
        return rows[0] ? toClient(rows[0]) : null;
      });
    },

    async list(organizationId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT c.*, count(a.id) AS account_count
          FROM core.clients c
          LEFT JOIN integrations.ad_accounts a ON a.client_id = c.id
          GROUP BY c.id
          ORDER BY coalesce(c.parent_client_id::text, c.id::text), c.parent_client_id NULLS FIRST, c.name`) as unknown as Row[];
        return rows.map((row) => ({ ...toClient(row), accountCount: Number(row.account_count ?? 0) }));
      });
    },
  };
}
