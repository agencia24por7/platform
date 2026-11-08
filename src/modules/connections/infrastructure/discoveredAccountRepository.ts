import { withTenant } from '@/shared/db/tenant';
import type { DiscoveredAccount } from '@/modules/connections/domain/discovery';
import type { Platform } from '@/modules/connections/domain/connection';

export type StoredDiscovery = DiscoveredAccount & {
  readonly id: string;
  readonly connectionId: string;
  readonly state: 'discovered' | 'linked' | 'ignored' | 'lost';
};

type Row = {
  id: string;
  connection_id: string;
  platform: Platform;
  external_id: string;
  name: string;
  currency: string;
  timezone: string;
  manager_external_id: string | null;
  inactive: boolean;
  state: StoredDiscovery['state'];
};

const toStored = (row: Row): StoredDiscovery => ({
  id: row.id,
  connectionId: row.connection_id,
  platform: row.platform,
  externalId: row.external_id,
  name: row.name,
  currency: row.currency,
  timezone: row.timezone,
  managerExternalId: row.manager_external_id,
  inactive: row.inactive,
  spendingLast30Days: null,
  state: row.state,
});

export type DiscoveredAccountRepository = {
  replace(
    organizationId: string,
    connectionId: string,
    accounts: readonly DiscoveredAccount[],
  ): Promise<number>;
  listPending(organizationId: string): Promise<readonly StoredDiscovery[]>;
  listAll(organizationId: string): Promise<readonly StoredDiscovery[]>;
  listByConnection(organizationId: string, connectionId: string): Promise<readonly StoredDiscovery[]>;
  markLinked(organizationId: string, id: string, adAccountId: string): Promise<void>;
  markIgnored(organizationId: string, id: string): Promise<void>;
};

export function createDiscoveredAccountRepository(): DiscoveredAccountRepository {
  return {
    async replace(organizationId, connectionId, accounts) {
      if (accounts.length === 0) return 0;

      return withTenant(organizationId, async (tx) => {
        const payload = accounts.map((account) => ({
          organization_id: organizationId,
          connection_id: connectionId,
          platform: account.platform,
          external_id: account.externalId,
          name: account.name,
          currency: account.currency,
          timezone: account.timezone,
          manager_external_id: account.managerExternalId,
          inactive: account.inactive,
        }));

        await tx`
          INSERT INTO integrations.connection_accounts ${tx(payload)}
          ON CONFLICT (connection_id, external_id) DO UPDATE SET
            name = EXCLUDED.name,
            currency = EXCLUDED.currency,
            timezone = EXCLUDED.timezone,
            manager_external_id = EXCLUDED.manager_external_id,
            inactive = EXCLUDED.inactive,
            discovered_at = now()`;

        return accounts.length;
      });
    },

    async listPending(organizationId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM integrations.connection_accounts
          WHERE state = 'discovered'
          ORDER BY inactive, name`) as unknown as Row[];
        return rows.map(toStored);
      });
    },

    async listAll(organizationId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM integrations.connection_accounts
          ORDER BY manager_external_id NULLS LAST, inactive, name`) as unknown as Row[];
        return rows.map(toStored);
      });
    },

    async listByConnection(organizationId, connectionId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM integrations.connection_accounts
          WHERE connection_id = ${connectionId}
          ORDER BY inactive, state, name`) as unknown as Row[];
        return rows.map(toStored);
      });
    },

    async markLinked(organizationId, id, adAccountId) {
      await withTenant(organizationId, async (tx) => {
        await tx`
          UPDATE integrations.connection_accounts
          SET state = 'linked', ad_account_id = ${adAccountId}
          WHERE id = ${id}`;
      });
    },

    async markIgnored(organizationId, id) {
      await withTenant(organizationId, async (tx) => {
        await tx`UPDATE integrations.connection_accounts SET state = 'ignored' WHERE id = ${id}`;
      });
    },
  };
}
