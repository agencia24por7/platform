import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { FederatedIdentity, MemberRole, Membership, User } from '@/modules/identity/domain/user';
import type { UserRepository } from '@/modules/identity/infrastructure/userRepository';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';

export type SignedInUser = {
  readonly user: User;
  readonly memberships: readonly Membership[];
};

export type IdentityService = {
  signIn(identity: FederatedIdentity, requestId: string): Promise<Result<SignedInUser, Failure>>;
  resolve(userId: string): Promise<SignedInUser | null>;
  joinAsOwner(organizationId: string, userId: string, requestId: string): Promise<Result<void, Failure>>;
  grantMembership(
    organizationId: string,
    userId: string,
    role: MemberRole,
    requestId: string,
  ): Promise<Result<void, Failure>>;
};

export function createIdentityService(users: UserRepository, audit: AuditRecorder): IdentityService {
  async function withMemberships(user: User): Promise<SignedInUser> {
    return { user, memberships: await users.membershipsOf(user.id) };
  }

  return {
    async signIn(identity, requestId) {
      if (!identity.emailVerified) {
        return err(failure('forbidden', 'O provedor não confirmou este e-mail.'));
      }

      const user = await users.upsertFromProvider(identity);
      const memberships = await users.membershipsOf(user.id);

      const alcance: readonly (string | null)[] =
        memberships.length > 0 ? memberships.map((m) => m.organizationId) : [null];

      for (const organizationId of alcance) {
        await audit.record({
          organizationId,
          actorType: 'user',
          actorId: user.id,
          action: 'identity.signed_in',
          targetType: 'user',
          targetId: user.id,
          requestId,
          metadata: { email: user.email, primeiroAcesso: memberships.length === 0 },
        });
      }

      return ok({ user, memberships });
    },

    async resolve(userId) {
      const user = await users.findById(userId);
      return user ? withMemberships(user) : null;
    },

    async joinAsOwner(organizationId, userId, requestId) {
      if ((await users.countMembers(organizationId)) > 0) {
        return err(failure('forbidden', 'Esta organização já tem responsável.'));
      }

      await users.addMember(organizationId, userId, 'owner');
      await audit.record({
        organizationId,
        actorType: 'user',
        actorId: userId,
        action: 'identity.became_owner',
        targetType: 'member',
        targetId: userId,
        requestId,
        metadata: { role: 'owner' },
      });

      return ok(undefined);
    },

    async grantMembership(organizationId, userId, role, requestId) {
      await users.addMember(organizationId, userId, role);
      await audit.record({
        organizationId,
        actorType: 'user',
        actorId: userId,
        action: 'identity.membership_granted',
        targetType: 'member',
        targetId: userId,
        requestId,
        metadata: { role },
      });

      return ok(undefined);
    },
  };
}
