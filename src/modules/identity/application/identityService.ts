import type { Ator } from '@/modules/audit/domain/actor';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { FederatedIdentity, MemberRole, Membership, User } from '@/modules/identity/domain/user';
import { eOperadorDaPlataforma } from '@/modules/identity/domain/operador';
import { sessaoAindaValida } from '@/modules/identity/domain/user';
import type { UserRepository } from '@/modules/identity/infrastructure/userRepository';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';

export type SignedInUser = {
  readonly user: User;
  readonly memberships: readonly Membership[];
};

export type IdentityService = {
  signIn(identity: FederatedIdentity, ator: Ator): Promise<Result<SignedInUser, Failure>>;
  resolve(userId: string, sessaoEmitidaEm: number): Promise<SignedInUser | null>;
  encerrarSessoes(userId: string): Promise<void>;
  sessaoValida(userId: string, sessaoEmitidaEm: number): Promise<boolean>;
  membershipsOf(userId: string): Promise<readonly Membership[]>;
  operadorDaPlataforma(userId: string, listaDeOperadores: string | undefined): Promise<boolean>;
  joinAsOwner(organizationId: string, ator: Ator): Promise<Result<void, Failure>>;
  grantMembership(organizationId: string, userId: string, role: MemberRole, ator: Ator): Promise<Result<void, Failure>>;
};

export function createIdentityService(users: UserRepository, audit: AuditRecorder): IdentityService {
  async function withMemberships(user: User): Promise<SignedInUser> {
    return { user, memberships: await users.membershipsOf(user.id) };
  }

  return {
    async signIn(identity, ator) {
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
          requestId: ator.requestId,
          sourceIp: ator.sourceIp,
          metadata: { email: user.email, primeiroAcesso: memberships.length === 0 },
        });
      }

      return ok({ user, memberships });
    },

    membershipsOf: (userId) => users.membershipsOf(userId),

    async operadorDaPlataforma(userId, listaDeOperadores) {
      if (!listaDeOperadores) return false;
      const user = await users.findById(userId);
      if (!user) return false;
      return eOperadorDaPlataforma({ email: user.email, emailVerificado: true }, listaDeOperadores);
    },

    async resolve(userId, sessaoEmitidaEm) {
      const user = await users.findById(userId);
      if (!user || !sessaoAindaValida(user, sessaoEmitidaEm)) return null;
      return withMemberships(user);
    },

    async encerrarSessoes(userId) {
      await users.encerrarSessoes(userId, new Date());
    },

    async sessaoValida(userId, sessaoEmitidaEm) {
      return users.sessaoValida(userId, new Date(sessaoEmitidaEm));
    },

    async joinAsOwner(organizationId, ator) {
      const userId = ator.userId;
      if (!userId) return err(failure('unauthorized', 'Sem sessão para assumir a organização.'));

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
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { role: 'owner' },
      });

      return ok(undefined);
    },

    async grantMembership(organizationId, userId, role, ator) {
      await users.addMember(organizationId, userId, role);
      await audit.record({
        organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'identity.membership_granted',
        targetType: 'member',
        targetId: userId,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { role },
      });

      return ok(undefined);
    },
  };
}
