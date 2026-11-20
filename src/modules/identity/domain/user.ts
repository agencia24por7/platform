export type MemberRole = 'owner' | 'admin' | 'operator' | 'viewer';

export type User = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly pictureUrl: string | null;
  readonly createdAt: Date;
  readonly lastLoginAt: Date | null;
  readonly sessoesValidasDesde?: Date | null;
};

export type Membership = {
  readonly organizationId: string;
  readonly role: MemberRole;
};

export type FederatedIdentity = {
  readonly email: string;
  readonly name: string;
  readonly pictureUrl: string | null;
  readonly emailVerified: boolean;
};

const ROLE_RANK: Record<MemberRole, number> = {
  owner: 4,
  admin: 3,
  operator: 2,
  viewer: 1,
};

export function canOperate(role: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.operator;
}

export function canAdminister(role: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.admin;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isUsableEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  if (email.length < 3 || email.length > 320) return false;
  if (/\s/.test(email)) return false;

  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return false;

  const domain = email.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

export function displayName(identity: FederatedIdentity): string {
  const name = identity.name.trim();
  if (name.length > 0) return name.slice(0, 160);

  const local = normalizeEmail(identity.email).split('@')[0] ?? 'pessoa';
  return local.slice(0, 160);
}

export function membershipFor(
  memberships: readonly Membership[],
  organizationId: string,
): Membership | null {
  return memberships.find((item) => item.organizationId === organizationId) ?? null;
}

export function sessaoAindaValida(user: Pick<User, 'sessoesValidasDesde'>, sessaoEmitidaEm: number): boolean {
  return !user.sessoesValidasDesde || sessaoEmitidaEm >= user.sessoesValidasDesde.getTime();
}
