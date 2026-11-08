import type { FederatedIdentity, MemberRole, Membership, User } from '@/modules/identity/domain/user';
import { displayName, normalizeEmail } from '@/modules/identity/domain/user';
import { withTenant, withoutTenant } from '@/shared/db/tenant';

type Row = {
  id: string;
  email: string;
  name: string;
  picture_url: string | null;
  created_at: Date;
  last_login_at: Date | null;
};

const toUser = (row: Row): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  pictureUrl: row.picture_url,
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
});

export type UserRepository = {
  upsertFromProvider(identity: FederatedIdentity): Promise<User>;
  findById(id: string): Promise<User | null>;
  membershipsOf(userId: string): Promise<readonly Membership[]>;
  addMember(organizationId: string, userId: string, role: MemberRole): Promise<void>;
  countMembers(organizationId: string): Promise<number>;
};

export function createUserRepository(): UserRepository {
  return {
    async upsertFromProvider(identity) {
      const email = normalizeEmail(identity.email);
      const name = displayName(identity);

      return withoutTenant(async (tx) => {
        const rows = (await tx`
          INSERT INTO core.users (email, name, picture_url, last_login_at)
          VALUES (${email}, ${name}, ${identity.pictureUrl}, now())
          ON CONFLICT (email) DO UPDATE
            SET name          = EXCLUDED.name,
                picture_url   = EXCLUDED.picture_url,
                last_login_at = now()
          RETURNING *`) as unknown as Row[];
        return toUser(rows[0]!);
      });
    },

    async findById(id) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`SELECT * FROM core.users WHERE id = ${id}`) as unknown as Row[];
        return rows[0] ? toUser(rows[0]) : null;
      });
    },

    async membershipsOf(userId) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT organization_id, role FROM core.memberships_of(${userId})
        `) as unknown as { organization_id: string; role: MemberRole }[];
        return rows.map((row) => ({ organizationId: row.organization_id, role: row.role }));
      });
    },

    async addMember(organizationId, userId, role) {
      await withTenant(organizationId, async (tx) => {
        await tx`
          INSERT INTO core.members (organization_id, user_id, role)
          VALUES (${organizationId}, ${userId}, ${role})
          ON CONFLICT (organization_id, user_id) DO NOTHING`;
      });
    },

    async countMembers(organizationId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT count(*)::int AS total FROM core.members WHERE organization_id = ${organizationId}
        `) as unknown as { total: number }[];
        return rows[0]?.total ?? 0;
      });
    },
  };
}
