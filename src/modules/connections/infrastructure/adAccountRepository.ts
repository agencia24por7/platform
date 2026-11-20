import { withTenant } from '@/shared/db/tenant';
import type { AdAccount, NewAdAccount } from '@/modules/connections/domain/adAccount';
import type { Platform } from '@/modules/connections/domain/connection';

type Row = {
  id: string;
  organization_id: string;
  client_id: string;
  connection_id: string;
  platform: Platform;
  external_id: string;
  name: string;
  account_group: string;
  currency: string;
  timezone: string;
  status: AdAccount['status'];
  sync_enabled: boolean;
  last_sync_at: Date | null;
  client_name?: string;
};

const toAccount = (row: Row): AdAccount => ({
  id: row.id,
  organizationId: row.organization_id,
  clientId: row.client_id,
  connectionId: row.connection_id,
  platform: row.platform,
  externalId: row.external_id,
  name: row.name,
  accountGroup: row.account_group,
  currency: row.currency,
  timezone: row.timezone,
  status: row.status,
  syncEnabled: row.sync_enabled,
  lastSyncAt: row.last_sync_at,
});

export type AdAccountRepository = {
  insert(input: NewAdAccount & { platform: Platform }): Promise<AdAccount>;
  findByExternalId(organizationId: string, platform: Platform, externalId: string): Promise<AdAccount | null>;
  listByClient(organizationId: string, clientId: string): Promise<readonly AdAccount[]>;
  listByOrganization(organizationId: string): Promise<readonly (AdAccount & { clientName: string })[]>;
  markSynced(organizationId: string, id: string, at: Date): Promise<void>;
  findById(organizationId: string, id: string): Promise<AdAccount | null>;
  reassign(organizationId: string, id: string, clientId: string): Promise<AdAccount | null>;
  setSync(organizationId: string, id: string, enabled: boolean): Promise<AdAccount | null>;
  desvincular(organizationId: string, id: string): Promise<AdAccount | null>;
  reativar(organizationId: string, id: string, input: NewAdAccount): Promise<AdAccount | null>;
};

export function createAdAccountRepository(): AdAccountRepository {
  return {
    async insert(input) {
      return withTenant(input.organizationId, async (tx) => {
        const rows = (await tx`
          INSERT INTO integrations.ad_accounts
            (organization_id, client_id, connection_id, platform, external_id, name, account_group, currency, timezone, sync_enabled)
          VALUES (${input.organizationId}, ${input.clientId}, ${input.connectionId}, ${input.platform},
                  ${input.externalId}, ${input.name}, ${input.accountGroup}, ${input.currency},
                  ${input.timezone}, ${input.syncEnabled})
          RETURNING *`) as unknown as Row[];
        return toAccount(rows[0]!);
      });
    },

    async findByExternalId(organizationId, platform, externalId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM integrations.ad_accounts
          WHERE platform = ${platform}::integrations.platform AND external_id = ${externalId}`) as unknown as Row[];
        return rows[0] ? toAccount(rows[0]) : null;
      });
    },

    async listByClient(organizationId, clientId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM integrations.ad_accounts WHERE client_id = ${clientId} AND status <> 'unlinked'
          ORDER BY platform, account_group`) as unknown as Row[];
        return rows.map(toAccount);
      });
    },

    async listByOrganization(organizationId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT a.*, c.name AS client_name
          FROM integrations.ad_accounts a
          JOIN core.clients c ON c.id = a.client_id
          WHERE a.status <> 'unlinked'
          ORDER BY c.name, a.platform`) as unknown as Row[];
        return rows.map((row) => ({ ...toAccount(row), clientName: row.client_name ?? '' }));
      });
    },

    async findById(organizationId, id) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM integrations.ad_accounts WHERE id = ${id}`) as unknown as Row[];
        return rows[0] ? toAccount(rows[0]) : null;
      });
    },

    async reassign(organizationId, id, clientId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE integrations.ad_accounts SET client_id = ${clientId}
          WHERE id = ${id}
          RETURNING *`) as unknown as Row[];
        return rows[0] ? toAccount(rows[0]) : null;
      });
    },

    async setSync(organizationId, id, enabled) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE integrations.ad_accounts SET sync_enabled = ${enabled}
          WHERE id = ${id}
          RETURNING *`) as unknown as Row[];
        return rows[0] ? toAccount(rows[0]) : null;
      });
    },

    async desvincular(organizationId, id) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE integrations.ad_accounts SET status = 'unlinked', sync_enabled = false
          WHERE id = ${id} AND status <> 'unlinked'
          RETURNING *`) as unknown as Row[];
        if (!rows[0]) return null;
        await tx`
          UPDATE integrations.connection_accounts SET state = 'discovered', ad_account_id = NULL
          WHERE ad_account_id = ${id}`;
        return toAccount(rows[0]);
      });
    },

    async reativar(organizationId, id, input) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE integrations.ad_accounts
          SET status = 'linked', client_id = ${input.clientId}, connection_id = ${input.connectionId},
              name = ${input.name}, account_group = ${input.accountGroup}, currency = ${input.currency},
              timezone = ${input.timezone}, sync_enabled = ${input.syncEnabled}
          WHERE id = ${id} AND status = 'unlinked'
          RETURNING *`) as unknown as Row[];
        return rows[0] ? toAccount(rows[0]) : null;
      });
    },

    async markSynced(organizationId, id, at) {
      await withTenant(organizationId, async (tx) => {
        await tx`UPDATE integrations.ad_accounts SET last_sync_at = ${at} WHERE id = ${id}`;
      });
    },
  };
}
