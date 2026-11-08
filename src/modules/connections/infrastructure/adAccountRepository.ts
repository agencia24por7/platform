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
          SELECT * FROM integrations.ad_accounts WHERE client_id = ${clientId}
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
          ORDER BY c.name, a.platform`) as unknown as Row[];
        return rows.map((row) => ({ ...toAccount(row), clientName: row.client_name ?? '' }));
      });
    },

    async markSynced(organizationId, id, at) {
      await withTenant(organizationId, async (tx) => {
        await tx`UPDATE integrations.ad_accounts SET last_sync_at = ${at} WHERE id = ${id}`;
      });
    },
  };
}
