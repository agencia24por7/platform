import { createHmac, timingSafeEqual } from 'node:crypto';

export type StateCookie = {
  readonly state: string;
  readonly returnTo: string;
  readonly organizationId: string | null;
  readonly userId: string | null;
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
  const body = [
    binding.state,
    binding.returnTo,
    binding.organizationId ?? '',
    binding.userId ?? '',
  ].join('|');
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

  const [state = '', returnTo = '', organizationId = '', userId = ''] = body.split('|');
  if (state.length === 0) return null;

  return {
    state,
    returnTo: returnTo.length > 0 ? returnTo : '/comecar?passo=contas',
    organizationId: organizationId.length > 0 ? organizationId : null,
    userId: userId.length > 0 ? userId : null,
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
