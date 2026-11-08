import { redirect } from 'next/navigation';
import { modules } from '@/composition';
import type { SignedInUser } from '@/modules/identity/application/identityService';
import type { MemberRole } from '@/modules/identity/domain/user';
import type { Organization } from '@/modules/organizations/domain/organization';
import { currentUser } from '@/shared/http/currentUser';

export type ActiveContext = {
  readonly session: SignedInUser;
  readonly organization: Organization;
  readonly role: MemberRole;
};

export async function currentOrganization(): Promise<Organization | null> {
  return (await activeContext())?.organization ?? null;
}

export async function activeContext(): Promise<ActiveContext | null> {
  const session = await currentUser();
  if (!session) return null;

  const membership = session.memberships[0];
  if (!membership) return null;

  const found = await modules().organizations.byId(membership.organizationId);
  if (!found.ok) return null;

  return { session, organization: found.value, role: membership.role };
}

export async function requireContext(): Promise<ActiveContext> {
  const session = await currentUser();
  if (!session) redirect('/entrar');

  const context = await activeContext();
  if (!context) redirect('/organizacoes/nova');

  return context;
}
