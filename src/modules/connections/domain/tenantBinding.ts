export type StateCookie = {
  readonly state: string;
  readonly returnTo: string;
  readonly organizationId: string | null;
};

export function encodeStateCookie(binding: StateCookie): string {
  return [binding.state, binding.returnTo, binding.organizationId ?? ''].join('|');
}

export function decodeStateCookie(raw: string): StateCookie | null {
  if (!raw) return null;

  const [state = '', returnTo = '', organizationId = ''] = raw.split('|');
  if (state.length === 0) return null;

  return {
    state,
    returnTo: returnTo.length > 0 ? returnTo : '/comecar?passo=contas',
    organizationId: organizationId.length > 0 ? organizationId : null,
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
