import type { MemberRole } from '@/modules/identity/domain/user';
import type { Convite, PapelConvidavel } from '@/modules/team/domain/convite';
import type { Membro } from '@/modules/team/domain/membro';
import { withTenant, withoutTenant } from '@/shared/db/tenant';

type ConviteRow = {
  id: string;
  organization_id: string;
  email: string;
  role: PapelConvidavel;
  invited_by: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  client_ids: string[] | null;
};

type MembroRow = {
  member_id: string;
  user_id: string;
  email: string;
  name: string;
  role: MemberRole;
  revoked_at: Date | null;
  created_at: Date;
  client_ids: string[] | null;
};

const toConvite = (row: ConviteRow): Convite => ({
  id: row.id,
  organizationId: row.organization_id,
  email: row.email,
  role: row.role,
  invitedBy: row.invited_by,
  expiresAt: row.expires_at,
  acceptedAt: row.accepted_at,
  revokedAt: row.revoked_at,
  createdAt: row.created_at,
  clientIds: row.client_ids ?? [],
});

const toMembro = (row: MembroRow): Membro => ({
  memberId: row.member_id,
  userId: row.user_id,
  email: row.email,
  name: row.name,
  role: row.role,
  revokedAt: row.revoked_at,
  clientIds: row.client_ids ?? [],
  createdAt: row.created_at,
});

export type PendingInvitation = {
  readonly invitationId: string;
  readonly organizationId: string;
  readonly role: MemberRole;
};

export type TeamRepository = {
  listMembers(organizationId: string): Promise<readonly Membro[]>;
  findMember(organizationId: string, memberId: string): Promise<Membro | null>;
  countOwners(organizationId: string): Promise<number>;
  revokeMember(organizationId: string, memberId: string, byUserId: string): Promise<void>;
  changeRole(organizationId: string, memberId: string, role: MemberRole): Promise<void>;
  replaceScope(organizationId: string, memberId: string, clientIds: readonly string[]): Promise<void>;

  listInvitations(organizationId: string): Promise<readonly Convite[]>;
  openInvitationFor(organizationId: string, email: string): Promise<Convite | null>;
  memberByEmail(organizationId: string, email: string): Promise<Membro | null>;
  insertInvitation(input: {
    organizationId: string;
    email: string;
    role: PapelConvidavel;
    invitedBy: string;
    expiresAt: Date;
    clientIds: readonly string[];
  }): Promise<Convite>;
  revokeInvitation(organizationId: string, invitationId: string): Promise<Convite | null>;

  pendingFor(email: string): Promise<readonly PendingInvitation[]>;
  accept(invitationId: string, userId: string): Promise<boolean>;
};

export function createTeamRepository(): TeamRepository {
  return {
    async listMembers(organizationId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT m.id AS member_id, m.user_id, u.email, u.name, m.role, m.revoked_at, m.created_at,
                 (SELECT array_agg(mc.client_id)
                    FROM core.member_clients mc
                   WHERE mc.member_id = m.id AND mc.revoked_at IS NULL) AS client_ids
          FROM core.members m
          JOIN core.users u ON u.id = m.user_id
          WHERE m.organization_id = ${organizationId}
          ORDER BY m.revoked_at NULLS FIRST, m.created_at`) as unknown as MembroRow[];
        return rows.map(toMembro);
      });
    },

    async findMember(organizationId, memberId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT m.id AS member_id, m.user_id, u.email, u.name, m.role, m.revoked_at, m.created_at,
                 (SELECT array_agg(mc.client_id)
                    FROM core.member_clients mc
                   WHERE mc.member_id = m.id AND mc.revoked_at IS NULL) AS client_ids
          FROM core.members m
          JOIN core.users u ON u.id = m.user_id
          WHERE m.organization_id = ${organizationId} AND m.id = ${memberId}`) as unknown as MembroRow[];
        return rows[0] ? toMembro(rows[0]) : null;
      });
    },

    async countOwners(organizationId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT count(*)::int AS total FROM core.members
          WHERE organization_id = ${organizationId} AND role = 'owner' AND revoked_at IS NULL
        `) as unknown as { total: number }[];
        return rows[0]?.total ?? 0;
      });
    },

    async revokeMember(organizationId, memberId, byUserId) {
      await withTenant(organizationId, async (tx) => {
        await tx`
          UPDATE core.members
          SET revoked_at = now(), revoked_by = ${byUserId}
          WHERE organization_id = ${organizationId} AND id = ${memberId} AND revoked_at IS NULL`;
      });
    },

    async changeRole(organizationId, memberId, role) {
      await withTenant(organizationId, async (tx) => {
        await tx`
          UPDATE core.members SET role = ${role}
          WHERE organization_id = ${organizationId} AND id = ${memberId} AND revoked_at IS NULL`;
      });
    },

    async replaceScope(organizationId, memberId, clientIds) {
      await withTenant(organizationId, async (tx) => {
        await tx`
          UPDATE core.member_clients SET revoked_at = now()
          WHERE member_id = ${memberId} AND revoked_at IS NULL
            AND NOT (client_id = ANY (${clientIds as string[]}::uuid[]))`;

        for (const clientId of clientIds) {
          await tx`
            INSERT INTO core.member_clients (member_id, client_id)
            VALUES (${memberId}, ${clientId})
            ON CONFLICT (member_id, client_id) DO UPDATE SET revoked_at = NULL`;
        }
      });
    },

    async listInvitations(organizationId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM core.invitations
          WHERE organization_id = ${organizationId}
          ORDER BY created_at DESC
          LIMIT 100`) as unknown as ConviteRow[];
        return rows.map(toConvite);
      });
    },

    async openInvitationFor(organizationId, email) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM core.invitations
          WHERE organization_id = ${organizationId}
            AND lower(email) = lower(${email})
            AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`) as unknown as ConviteRow[];
        return rows[0] ? toConvite(rows[0]) : null;
      });
    },

    async memberByEmail(organizationId, email) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT m.id AS member_id, m.user_id, u.email, u.name, m.role, m.revoked_at, m.created_at,
                 NULL::uuid[] AS client_ids
          FROM core.members m
          JOIN core.users u ON u.id = m.user_id
          WHERE m.organization_id = ${organizationId}
            AND lower(u.email) = lower(${email})
            AND m.revoked_at IS NULL`) as unknown as MembroRow[];
        return rows[0] ? toMembro(rows[0]) : null;
      });
    },

    async insertInvitation(input) {
      return withTenant(input.organizationId, async (tx) => {
        const rows = (await tx`
          INSERT INTO core.invitations (organization_id, email, role, invited_by, expires_at, client_ids)
          VALUES (${input.organizationId}, ${input.email}, ${input.role}, ${input.invitedBy},
                  ${input.expiresAt}, ${input.clientIds as string[]}::uuid[])
          RETURNING *`) as unknown as ConviteRow[];
        return toConvite(rows[0]!);
      });
    },

    async revokeInvitation(organizationId, invitationId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE core.invitations SET revoked_at = now()
          WHERE organization_id = ${organizationId} AND id = ${invitationId}
            AND accepted_at IS NULL AND revoked_at IS NULL
          RETURNING *`) as unknown as ConviteRow[];
        return rows[0] ? toConvite(rows[0]) : null;
      });
    },

    async pendingFor(email) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT invitation_id, organization_id, role FROM core.pending_invitations_for(${email})
        `) as unknown as { invitation_id: string; organization_id: string; role: MemberRole }[];
        return rows.map((row) => ({
          invitationId: row.invitation_id,
          organizationId: row.organization_id,
          role: row.role,
        }));
      });
    },

    async accept(invitationId, userId) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT core.accept_invitation(${invitationId}::uuid, ${userId}::uuid) AS aceito
        `) as unknown as { aceito: boolean }[];
        return rows[0]?.aceito === true;
      });
    },
  };
}
