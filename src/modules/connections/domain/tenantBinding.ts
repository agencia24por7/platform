import { createHmac, timingSafeEqual } from 'node:crypto';

export type StateCookie = {
  readonly state: string;
  readonly returnTo: string;
  readonly organizationId: string | null;
  readonly userId: string | null;
  readonly inviteItemId: string | null;
};

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function signatureMatches(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function encodeStateCookie(binding: StateCookie, secret: string): string {
  const body = JSON.stringify({
    state: binding.state,
    returnTo: binding.returnTo,
    organizationId: binding.organizationId,
    userId: binding.userId,
    inviteItemId: binding.inviteItemId,
  });
  return `${Buffer.from(body).toString('base64url')}.${sign(body, secret)}`;
}

export function decodeStateCookie(raw: string, secret: string): StateCookie | null {
  if (!raw) return null;

  const separator = raw.lastIndexOf('.');
  if (separator < 1) return null;

  let body: string;
  try {
    body = Buffer.from(raw.slice(0, separator), 'base64url').toString('utf8');
  } catch {
    return null;
  }

  if (!signatureMatches(raw.slice(separator + 1), sign(body, secret))) return null;

  let bruto: unknown;
  try {
    bruto = JSON.parse(body);
  } catch {
    return null;
  }

  if (typeof bruto !== 'object' || bruto === null) return null;
  const campos = bruto as Record<string, unknown>;

  const state = campos['state'];
  if (typeof state !== 'string' || state.length === 0) return null;

  const returnTo = campos['returnTo'];
  const organizationId = campos['organizationId'];
  const userId = campos['userId'];
  const inviteItemId = campos['inviteItemId'];
  if (organizationId !== null && typeof organizationId !== 'string') return null;
  if (userId !== null && typeof userId !== 'string') return null;
  if (inviteItemId !== undefined && inviteItemId !== null && typeof inviteItemId !== 'string') return null;

  return {
    state,
    returnTo: typeof returnTo === 'string' && returnTo.length > 0 ? returnTo : '/comecar?passo=contas',
    organizationId: organizationId || null,
    userId: userId || null,
    inviteItemId: (inviteItemId as string | null | undefined) || null,
  };
}

export type BindingDecision =
  | { readonly kind: 'create' }
  | { readonly kind: 'use'; readonly organizationId: string }
  | { readonly kind: 'refuse'; readonly reason: 'ambiguo' };

export function decideBinding(
  boundOrganizationId: string | null,
  existingOrganizations: number,
): BindingDecision {
  if (boundOrganizationId) return { kind: 'use', organizationId: boundOrganizationId };
  if (existingOrganizations === 0) return { kind: 'create' };
  return { kind: 'refuse', reason: 'ambiguo' };
}
