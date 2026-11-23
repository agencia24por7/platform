import { withTenant, withoutTenant } from '@/shared/db/tenant';
import type { Platform } from '@/modules/connections/domain/connection';
import { expiracaoPadrao, gerarTokenDeConvite } from '@/modules/connections/domain/integrationInvite';

export type InviteStatus = 'pending' | 'completed' | 'expired' | 'revoked';

export type IntegrationInviteItem = {
  readonly id: string;
  readonly platform: Platform;
  readonly status: InviteStatus;
  readonly connectionId: string | null;
  readonly completedAt: Date | null;
};

export type IntegrationInvite = {
  readonly id: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly token: string;
  readonly status: InviteStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly items: readonly IntegrationInviteItem[];
};

export type ResolvedInviteItem = {
  readonly inviteId: string;
  readonly itemId: string;
  readonly organizationId: string;
  readonly clientId: string;
};

export type CompletedInviteItem = {
  readonly clientId: string;
  readonly organizationId: string;
};

export type PublicInviteView = {
  readonly status: InviteStatus;
  readonly expiresAt: Date;
  readonly organizationName: string;
  readonly items: readonly { readonly platform: Platform; readonly status: InviteStatus }[];
};

type InviteRow = {
  id: string;
  organization_id: string;
  client_id: string;
  token: string;
  status: InviteStatus;
  created_at: Date;
  expires_at: Date;
};

type ItemRow = {
  id: string;
  invite_id: string;
  platform: Platform;
  status: InviteStatus;
  connection_id: string | null;
  completed_at: Date | null;
};

export type ConnectionInviteRepository = {
  create(input: {
    readonly organizationId: string;
    readonly clientId: string;
    readonly platforms: readonly Platform[];
    readonly createdBy: string | null;
  }): Promise<IntegrationInvite>;
  listByClient(organizationId: string, clientId: string): Promise<readonly IntegrationInvite[]>;
  resolveByToken(token: string, platform: Platform): Promise<ResolvedInviteItem | null>;
  forDisplay(token: string): Promise<PublicInviteView | null>;
  stillPending(organizationId: string, itemId: string): Promise<{ readonly organizationId: string; readonly clientId: string } | null>;
  completeItem(organizationId: string, itemId: string, connectionId: string): Promise<CompletedInviteItem | null>;
  revoke(organizationId: string, inviteId: string): Promise<{ readonly clientId: string } | null>;
};

function toItem(row: ItemRow): IntegrationInviteItem {
  return {
    id: row.id,
    platform: row.platform,
    status: row.status,
    connectionId: row.connection_id,
    completedAt: row.completed_at,
  };
}

export function createConnectionInviteRepository(): ConnectionInviteRepository {
  return {
    async create(input) {
      return withTenant(input.organizationId, async (tx) => {
        const token = gerarTokenDeConvite();
        const expiresAt = expiracaoPadrao(new Date());

        const invites = (await tx`
          INSERT INTO integrations.connection_invites
            (organization_id, client_id, kind, token, expires_at, created_by)
          VALUES (${input.organizationId}, ${input.clientId}, 'oauth_self_service', ${token}, ${expiresAt}, ${input.createdBy})
          RETURNING *`) as unknown as InviteRow[];
        const invite = invites[0]!;

        const payload = input.platforms.map((platform) => ({
          invite_id: invite.id,
          organization_id: input.organizationId,
          platform,
        }));

        const items = (await tx`
          INSERT INTO integrations.connection_invite_items ${tx(payload)}
          RETURNING *`) as unknown as ItemRow[];

        return {
          id: invite.id,
          organizationId: invite.organization_id,
          clientId: invite.client_id,
          token: invite.token,
          status: invite.status,
          createdAt: invite.created_at,
          expiresAt: invite.expires_at,
          items: items.map(toItem),
        };
      });
    },

    async listByClient(organizationId, clientId) {
      return withTenant(organizationId, async (tx) => {
        const invites = (await tx`
          SELECT * FROM integrations.connection_invites
          WHERE client_id = ${clientId}
          ORDER BY created_at DESC`) as unknown as InviteRow[];

        if (invites.length === 0) return [];

        const items = (await tx`
          SELECT * FROM integrations.connection_invite_items
          WHERE invite_id = ANY(${invites.map((invite) => invite.id)}::uuid[])`) as unknown as ItemRow[];

        return invites.map((invite) => ({
          id: invite.id,
          organizationId: invite.organization_id,
          clientId: invite.client_id,
          token: invite.token,
          status: invite.status,
          createdAt: invite.created_at,
          expiresAt: invite.expires_at,
          items: items.filter((item) => item.invite_id === invite.id).map(toItem),
        }));
      });
    },

    async resolveByToken(token, platform) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT * FROM integrations.resolve_invite_item(${token}, ${platform}::integrations.platform)
        `) as unknown as {
          invite_id: string;
          item_id: string;
          organization_id: string;
          client_id: string;
          status: InviteStatus;
        }[];

        const row = rows[0];
        if (!row) return null;

        return {
          inviteId: row.invite_id,
          itemId: row.item_id,
          organizationId: row.organization_id,
          clientId: row.client_id,
        };
      });
    },

    async forDisplay(token) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT * FROM integrations.resolve_invite_for_display(${token})
        `) as unknown as {
          invite_id: string;
          status: InviteStatus;
          expires_at: Date;
          organization_name: string;
          items: { platform: Platform; status: InviteStatus }[];
        }[];

        const row = rows[0];
        if (!row) return null;

        return {
          status: row.status,
          expiresAt: row.expires_at,
          organizationName: row.organization_name,
          items: row.items,
        };
      });
    },

    async stillPending(organizationId, itemId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM integrations.invite_item_still_pending(${itemId})
        `) as unknown as { organization_id: string; client_id: string }[];

        const row = rows[0];
        return row ? { organizationId: row.organization_id, clientId: row.client_id } : null;
      });
    },

    async completeItem(organizationId, itemId, connectionId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM integrations.complete_invite_item(${itemId}, ${connectionId})
        `) as unknown as { client_id: string; organization_id: string }[];

        const row = rows[0];
        return row ? { clientId: row.client_id, organizationId: row.organization_id } : null;
      });
    },

    async revoke(organizationId, inviteId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE integrations.connection_invites
          SET status = 'revoked', revoked_at = now()
          WHERE id = ${inviteId} AND status = 'pending'
          RETURNING client_id`) as unknown as { client_id: string }[];
        return rows[0] ? { clientId: rows[0].client_id } : null;
      });
    },
  };
}
