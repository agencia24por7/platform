import { modules } from '@/composition';
import { canAdminister } from '@/modules/identity/domain/user';
import { idValido } from '@/modules/clients/domain/painel/enderecos';
import { requireContext } from '@/shared/http/currentOrganization';

type Contexto = Awaited<ReturnType<typeof requireContext>>;

export async function clienteNoEscopo(ctx: Contexto, clientId: string) {
  if (!idValido(clientId)) return null;
  if (ctx.clientIds !== null && !ctx.clientIds.includes(clientId)) return null;
  const encontrado = await modules().clients.byId(ctx.organization.id, clientId);
  return encontrado.ok ? encontrado.value : null;
}

export async function escopoDoClienteNaOrganizacao(clientId: string) {
  const ctx = await requireContext();
  const cliente = await clienteNoEscopo(ctx, clientId);
  if (!cliente) return null;
  return {
    ctx,
    cliente,
    admin: canAdminister(ctx.role),
    comando: { organizationId: ctx.organization.id, clientId, papelDeQuemAge: ctx.role },
  };
}
