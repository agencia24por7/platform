import type { MemberRole } from '../../identity/domain/user.ts';
import { canAdminister } from '../../identity/domain/user.ts';

export type Membro = {
  readonly memberId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: MemberRole;
  readonly revokedAt: Date | null;
  readonly clientIds: readonly string[];
  readonly createdAt: Date;
};

export const MOTIVO_BLOQUEIO = {
  sem_permissao: 'Só quem administra a organização pode mexer na equipe.',
  nao_encontrado: 'Esse vínculo não existe nesta organização.',
  ultimo_dono: 'A organização ficaria sem responsável. Promova alguém antes.',
  proprio_vinculo: 'Você não pode revogar o próprio acesso.',
  papel_invalido: 'Papel desconhecido.',
} as const;

export type MotivoBloqueio = keyof typeof MOTIVO_BLOQUEIO;

export function podeMexerNaEquipe(role: MemberRole): boolean {
  return canAdminister(role);
}

export function revogacaoPermitida(input: {
  readonly papelDeQuemAge: MemberRole;
  readonly userIdDeQuemAge: string;
  readonly alvo: Membro;
  readonly donosVivos: number;
}): MotivoBloqueio | null {
  if (!podeMexerNaEquipe(input.papelDeQuemAge)) return 'sem_permissao';
  if (input.alvo.userId === input.userIdDeQuemAge) return 'proprio_vinculo';
  if (input.alvo.role === 'owner' && input.donosVivos <= 1) return 'ultimo_dono';
  return null;
}

export function trocaDePapelPermitida(input: {
  readonly papelDeQuemAge: MemberRole;
  readonly userIdDeQuemAge: string;
  readonly alvo: Membro;
  readonly novoPapel: MemberRole;
  readonly donosVivos: number;
}): MotivoBloqueio | null {
  if (!podeMexerNaEquipe(input.papelDeQuemAge)) return 'sem_permissao';
  if (input.novoPapel === 'owner' && input.papelDeQuemAge !== 'owner') return 'sem_permissao';
  if (input.alvo.role === 'owner' && input.novoPapel !== 'owner' && input.donosVivos <= 1) {
    return 'ultimo_dono';
  }
  if (input.alvo.userId === input.userIdDeQuemAge && input.alvo.role === 'owner') {
    return 'proprio_vinculo';
  }
  return null;
}
