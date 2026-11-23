import type { MemberRole } from '../../identity/domain/user.ts';
import { canAdminister, isUsableEmail, normalizeEmail } from '../../identity/domain/user.ts';

import type { EscopoDoVinculo } from './recorte.ts';

export const EXPIRACAO_DIAS = 7;

export const PAPEIS_CONVIDAVEIS = ['admin', 'operator', 'viewer'] as const;
export type PapelConvidavel = (typeof PAPEIS_CONVIDAVEIS)[number];

export type Convite = {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: PapelConvidavel;
  readonly invitedBy: string | null;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly clientIds: readonly string[];
  readonly escopo: EscopoDoVinculo;
};

export const MOTIVO_RECUSA = {
  sem_permissao: 'Só quem administra a organização pode convidar.',
  papel_invalido: 'Esse papel não pode ser concedido por convite.',
  email_invalido: 'Informe um e-mail válido.',
  ja_e_membro: 'Essa pessoa já faz parte da equipe.',
  ja_convidado: 'Já existe um convite aberto para esse e-mail.',
} as const;

export type MotivoRecusa = keyof typeof MOTIVO_RECUSA;

export function ehPapelConvidavel(valor: string): valor is PapelConvidavel {
  return (PAPEIS_CONVIDAVEIS as readonly string[]).includes(valor);
}

export function validarConvite(input: {
  readonly papelDeQuemConvida: MemberRole;
  readonly email: string;
  readonly role: string;
}): MotivoRecusa | null {
  if (!canAdminister(input.papelDeQuemConvida)) return 'sem_permissao';
  if (!ehPapelConvidavel(input.role)) return 'papel_invalido';
  if (!isUsableEmail(input.email)) return 'email_invalido';
  return null;
}

export function expiraEm(agora: Date): Date {
  return new Date(agora.getTime() + EXPIRACAO_DIAS * 24 * 60 * 60 * 1000);
}

export function emailDoConvite(bruto: string): string {
  return normalizeEmail(bruto);
}

export function conviteVivo(convite: Convite, agora: Date): boolean {
  return convite.acceptedAt === null && convite.revokedAt === null && convite.expiresAt > agora;
}
