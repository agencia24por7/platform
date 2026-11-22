import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { Ator } from '@/modules/audit/domain/actor';
import type { MemberRole } from '@/modules/identity/domain/user';
import type { Convite, MotivoRecusa, PapelConvidavel } from '@/modules/team/domain/convite';
import {
  MOTIVO_RECUSA,
  emailDoConvite,
  expiraEm,
  validarConvite,
} from '@/modules/team/domain/convite';
import type { Membro, MotivoBloqueio } from '@/modules/team/domain/membro';
import {
  MOTIVO_BLOQUEIO,
  podeMexerNaEquipe,
  podeMexerNesteVinculo,
  revogacaoPermitida,
  trocaDePapelPermitida,
} from '@/modules/team/domain/membro';
import type { ModoDoRecorte } from '@/modules/team/domain/recorte';
import { MOTIVO_RECORTE, idsDoRecorte, validarRecorte } from '@/modules/team/domain/recorte';
import type { TeamRepository } from '@/modules/team/infrastructure/teamRepository';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';

const recusa = (motivo: MotivoRecusa): Failure =>
  failure(motivo === 'sem_permissao' ? 'forbidden' : 'validation', MOTIVO_RECUSA[motivo]);

const bloqueio = (motivo: MotivoBloqueio): Failure =>
  failure(motivo === 'sem_permissao' ? 'forbidden' : 'conflict', MOTIVO_BLOQUEIO[motivo]);

export type Equipe = {
  readonly membros: readonly Membro[];
  readonly convites: readonly Convite[];
};

export type TeamService = {
  equipe(organizationId: string): Promise<Equipe>;
  convidar(input: {
    organizationId: string;
    papelDeQuemConvida: MemberRole;
    email: string;
    role: string;
    recorte: ModoDoRecorte;
  }, ator: Ator): Promise<Result<Convite, Failure>>;
  revogarConvite(
    organizationId: string,
    papelDeQuemAge: MemberRole,
    invitationId: string,
    ator: Ator,
  ): Promise<Result<void, Failure>>;
  revogarMembro(input: {
    organizationId: string;
    papelDeQuemAge: MemberRole;
    memberId: string;
  }, ator: Ator): Promise<Result<void, Failure>>;
  trocarPapel(input: {
    organizationId: string;
    papelDeQuemAge: MemberRole;
    memberId: string;
    novoPapel: string;
  }, ator: Ator): Promise<Result<void, Failure>>;
  definirEscopo(input: {
    organizationId: string;
    papelDeQuemAge: MemberRole;
    memberId: string;
    recorte: ModoDoRecorte;
  }, ator: Ator): Promise<Result<void, Failure>>;
  aceitarPendentes(userId: string, email: string, ator: Ator): Promise<readonly string[]>;
};

const PAPEIS: readonly MemberRole[] = ['owner', 'admin', 'operator', 'viewer'];

async function conferirRecorte(
  repository: TeamRepository,
  organizationId: string,
  recorte: ModoDoRecorte,
): Promise<Failure | null> {
  const motivo = validarRecorte(recorte);
  if (motivo) return failure('validation', MOTIVO_RECORTE[motivo]);
  if (recorte.modo === 'organizacao') return null;

  const ids = idsDoRecorte(recorte);
  const vivos = await repository.clientesVivosDaOrganizacao(organizationId, ids);
  return vivos === ids.length ? null : failure('validation', MOTIVO_RECORTE.cliente_invalido);
}

export function createTeamService(repository: TeamRepository, audit: AuditRecorder): TeamService {
  async function exigirMembro(
    organizationId: string,
    memberId: string,
  ): Promise<Result<Membro, Failure>> {
    const membro = await repository.findMember(organizationId, memberId);
    if (!membro || membro.revokedAt) return err(bloqueio('nao_encontrado'));
    return ok(membro);
  }

  return {
    async equipe(organizationId) {
      const [membros, convites] = await Promise.all([
        repository.listMembers(organizationId),
        repository.listInvitations(organizationId),
      ]);
      return { membros, convites };
    },

    async convidar(input, ator) {
      const email = emailDoConvite(input.email);
      const motivo = validarConvite({
        papelDeQuemConvida: input.papelDeQuemConvida,
        email,
        role: input.role,
      });
      if (motivo) return err(recusa(motivo));
      if (!ator.userId) return err(failure('unauthorized', 'Sem sessão para convidar.'));

      const problema = await conferirRecorte(repository, input.organizationId, input.recorte);
      if (problema) return err(problema);

      if (await repository.memberByEmail(input.organizationId, email)) {
        return err(recusa('ja_e_membro'));
      }
      if (await repository.openInvitationFor(input.organizationId, email)) {
        return err(recusa('ja_convidado'));
      }

      const convite = await repository.insertInvitation({
        organizationId: input.organizationId,
        email,
        role: input.role as PapelConvidavel,
        invitedBy: ator.userId,
        expiresAt: expiraEm(new Date()),
        recorte: input.recorte,
      });

      await audit.record({
        organizationId: input.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'team.invited',
        targetType: 'invitation',
        targetId: convite.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: {
          email,
          role: convite.role,
          clientesNoEscopo: idsDoRecorte(input.recorte).length,
          organizacaoInteira: input.recorte.modo === 'organizacao',
        },
      });

      return ok(convite);
    },

    async revogarConvite(organizationId, papelDeQuemAge, invitationId, ator) {
      if (!podeMexerNaEquipe(papelDeQuemAge)) return err(bloqueio('sem_permissao'));

      const convite = await repository.revokeInvitation(organizationId, invitationId);
      if (!convite) return err(bloqueio('nao_encontrado'));

      await audit.record({
        organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'team.invitation_revoked',
        targetType: 'invitation',
        targetId: convite.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { email: convite.email, role: convite.role },
      });

      return ok(undefined);
    },

    async revogarMembro(input, ator) {
      if (!ator.userId) return err(failure('unauthorized', 'Sem sessão.'));

      const alvo = await exigirMembro(input.organizationId, input.memberId);
      if (!alvo.ok) return alvo;

      const motivo = revogacaoPermitida({
        papelDeQuemAge: input.papelDeQuemAge,
        userIdDeQuemAge: ator.userId,
        alvo: alvo.value,
        donosVivos: await repository.countOwners(input.organizationId),
      });
      if (motivo) return err(bloqueio(motivo));

      await repository.revokeMember(input.organizationId, input.memberId, ator.userId);

      await audit.record({
        organizationId: input.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'team.member_revoked',
        targetType: 'member',
        targetId: alvo.value.userId,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { email: alvo.value.email, role: alvo.value.role },
      });

      return ok(undefined);
    },

    async trocarPapel(input, ator) {
      if (!ator.userId) return err(failure('unauthorized', 'Sem sessão.'));
      if (!PAPEIS.includes(input.novoPapel as MemberRole)) return err(bloqueio('papel_invalido'));

      const alvo = await exigirMembro(input.organizationId, input.memberId);
      if (!alvo.ok) return alvo;

      const novoPapel = input.novoPapel as MemberRole;
      const motivo = trocaDePapelPermitida({
        papelDeQuemAge: input.papelDeQuemAge,
        userIdDeQuemAge: ator.userId,
        alvo: alvo.value,
        novoPapel,
        donosVivos: await repository.countOwners(input.organizationId),
      });
      if (motivo) return err(bloqueio(motivo));

      await repository.changeRole(input.organizationId, input.memberId, novoPapel);

      await audit.record({
        organizationId: input.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'team.role_changed',
        targetType: 'member',
        targetId: alvo.value.userId,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { email: alvo.value.email, de: alvo.value.role, para: novoPapel },
      });

      return ok(undefined);
    },

    async definirEscopo(input, ator) {
      if (!podeMexerNaEquipe(input.papelDeQuemAge)) return err(bloqueio('sem_permissao'));

      const alvo = await exigirMembro(input.organizationId, input.memberId);
      if (!alvo.ok) return alvo;
      if (!podeMexerNesteVinculo(input.papelDeQuemAge, alvo.value)) {
        return err(bloqueio('sem_permissao'));
      }

      const problema = await conferirRecorte(repository, input.organizationId, input.recorte);
      if (problema) return err(problema);

      await repository.replaceScope(input.organizationId, input.memberId, input.recorte);

      await audit.record({
        organizationId: input.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'team.scope_changed',
        targetType: 'member',
        targetId: alvo.value.userId,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: {
          email: alvo.value.email,
          de: alvo.value.clientIds.length,
          para: idsDoRecorte(input.recorte).length,
          organizacaoInteira: input.recorte.modo === 'organizacao',
        },
      });

      return ok(undefined);
    },

    async aceitarPendentes(userId, email, ator) {
      const pendentes = await repository.pendingFor(userId, email);
      const entrou: string[] = [];

      for (const convite of pendentes) {
        if (!(await repository.accept(convite.invitationId, userId))) continue;
        entrou.push(convite.organizationId);

        await audit.record({
          organizationId: convite.organizationId,
          actorType: 'user',
          actorId: userId,
          action: 'team.joined',
          targetType: 'member',
          targetId: userId,
          requestId: ator.requestId,
          sourceIp: ator.sourceIp,
          metadata: { email, role: convite.role, invitationId: convite.invitationId },
        });
      }

      return entrou;
    },
  };
}
