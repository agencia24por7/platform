import { notFound } from 'next/navigation';
import { cache } from 'react';
import { modules } from '@/composition';
import { canAdminister, canOperate } from '@/modules/identity/domain/user';
import { idValido } from '@/modules/clients/domain/painel/enderecos';
import { requireContext } from '@/shared/http/currentOrganization';

export const carregarPainel = cache(async (id: string) => {
  const ctx = await requireContext();
  if (!idValido(id)) notFound();
  if (ctx.clientIds !== null && !ctx.clientIds.includes(id)) notFound();
  const encontrado = await modules().clients.byId(ctx.organization.id, id);
  if (!encontrado.ok) notFound();
  return {
    ctx,
    cliente: encontrado.value,
    podeEditar: canOperate(ctx.role),
    podeAdministrar: canAdminister(ctx.role),
    organizacaoInteira: ctx.clientIds === null,
  };
});

export const carregarContexto = cache(async (organizationId: string, clientId: string) => {
  const resultado = await modules().contexto.carregar({ organizationId, clientId });
  return resultado.ok ? resultado.value : null;
});

export const carregarContas = cache(async (organizationId: string, clientId: string) =>
  Promise.all([
    modules().connections.listAccountsByClient(organizationId, clientId),
    modules().recursos.listarPorCliente(organizationId, clientId),
  ]),
);

export type Aviso = { readonly erro?: string; readonly feito?: string };

export function primeiro(valor: string | readonly string[] | undefined): string | undefined {
  return Array.isArray(valor) ? (valor[0] as string | undefined) : (valor as string | undefined);
}
