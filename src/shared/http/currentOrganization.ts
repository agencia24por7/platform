import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { modules } from '@/composition';
import type { SignedInUser } from '@/modules/identity/application/identityService';
import { ORGANIZACAO_COOKIE, organizacaoAtiva } from '@/modules/identity/domain/organizacaoAtiva';
import type { MemberRole } from '@/modules/identity/domain/user';
import type { Organization } from '@/modules/organizations/domain/organization';
import { atorAtual } from '@/shared/http/ator';
import { currentUser } from '@/shared/http/currentUser';
import { escopoDeCliente, ORGANIZACAO_INTEIRA } from '@/shared/db/escopo';

export type ActiveContext = {
  readonly session: SignedInUser;
  readonly organization: Organization;
  readonly role: MemberRole;
  readonly clientIds: readonly string[] | null;
};

export async function currentOrganization(): Promise<Organization | null> {
  return (await activeContext())?.organization ?? null;
}

export async function activeContext(): Promise<ActiveContext | null> {
  const session = await currentUser();
  if (!session) return null;

  const escolhida = (await cookies()).get(ORGANIZACAO_COOKIE)?.value;
  const membership = organizacaoAtiva(session.memberships, escolhida);
  if (!membership) return null;

  const found = await modules().organizations.byId(membership.organizationId);
  if (!found.ok) return null;

  const escopo = await escopoDeCliente(membership.organizationId);

  return {
    session,
    organization: found.value,
    role: membership.role,
    clientIds: escopo === ORGANIZACAO_INTEIRA ? null : escopo.split(','),
  };
}

export async function requireContext(): Promise<ActiveContext> {
  const session = await currentUser();
  if (!session) redirect('/entrar');

  if (session.memberships.length === 0) {
    await modules().team.aceitarPendentes(session.user.id, session.user.email, await atorAtual());
  }

  const context = await activeContext();
  if (!context) redirect('/organizacoes/nova');

  return context;
}
