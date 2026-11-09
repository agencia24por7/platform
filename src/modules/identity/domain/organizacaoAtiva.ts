import type { Membership } from '@/modules/identity/domain/user';

export const ORGANIZACAO_COOKIE = 'tria_organizacao';
export const ORGANIZACAO_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function organizacaoAtiva(
  memberships: readonly Membership[],
  escolhida: string | undefined,
): Membership | null {
  if (memberships.length === 0) return null;

  const pedida = escolhida
    ? memberships.find((item) => item.organizationId === escolhida)
    : undefined;

  return pedida ?? memberships[0]!;
}
