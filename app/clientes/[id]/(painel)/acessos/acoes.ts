'use server';

import { redirect } from 'next/navigation';
import { modules } from '@/composition';
import { comAviso, enderecoDoConvite, enderecoDoFormulario, idValido, rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import { env } from '@/shared/config/env';
import { text } from '@/shared/http/actions';
import { atorAtual } from '@/shared/http/ator';
import { requireContext } from '@/shared/http/currentOrganization';
import { canAdminister } from '@/modules/identity/domain/user';

export type LinkGerado =
  | {
      readonly ok: true;
      readonly url: string;
      readonly conviteUrl: string | null;
      readonly expiraEm: string;
      readonly secoes: readonly string[];
    }
  | { readonly ok: false; readonly erro: string };

async function escopoDoCliente(clientId: string) {
  const ctx = await requireContext();
  if (!idValido(clientId)) return null;
  if (ctx.clientIds !== null && !ctx.clientIds.includes(clientId)) return null;
  return { ctx, admin: canAdminister(ctx.role), comando: { organizationId: ctx.organization.id, clientId, papelDeQuemAge: ctx.role } };
}

async function urlDoConvite(organizationId: string, clientId: string, conviteId: string | null): Promise<string | null> {
  if (!conviteId) return null;
  const convites = await modules().connectionInvites.listByClient(organizationId, clientId);
  const convite = convites.find((c) => c.id === conviteId);
  return convite ? enderecoDoConvite(env().TRIA_APP_BASE_URL, convite.token) : null;
}

export async function criarLinkDeContexto(
  clientId: string,
  pedido: { readonly secoes: readonly string[]; readonly expiraEmDias: number; readonly nota: string; readonly conviteDeIntegracaoId: string | null },
): Promise<LinkGerado> {
  const escopo = await escopoDoCliente(clientId);
  if (!escopo) return { ok: false, erro: 'Cliente não encontrado.' };
  if (pedido.conviteDeIntegracaoId && !escopo.admin) {
    return { ok: false, erro: 'Só quem administra a organização pode juntar o mapa a um convite de integração.' };
  }
  const resultado = await modules().contexto.criarLink(
    {
      ...escopo.comando,
      secoes: pedido.secoes,
      expiraEmDias: pedido.expiraEmDias,
      nota: pedido.nota,
      conviteDeIntegracaoId: pedido.conviteDeIntegracaoId,
    },
    await atorAtual(),
  );
  if (!resultado.ok) return { ok: false, erro: resultado.error.message };
  const { link, token } = resultado.value;
  return {
    ok: true,
    url: enderecoDoFormulario(env().TRIA_APP_BASE_URL, token),
    conviteUrl: escopo.admin ? await urlDoConvite(escopo.comando.organizationId, clientId, link.conviteDeIntegracaoId) : null,
    expiraEm: link.expiraEm.toISOString(),
    secoes: link.secoes,
  };
}

export async function regenerarLinkDeContexto(clientId: string, linkId: string): Promise<LinkGerado> {
  const escopo = await escopoDoCliente(clientId);
  if (!escopo || !idValido(linkId)) return { ok: false, erro: 'Link não encontrado.' };
  const resultado = await modules().contexto.regenerarLink({ ...escopo.comando, linkId }, await atorAtual());
  if (!resultado.ok) return { ok: false, erro: resultado.error.message };
  const { link, token } = resultado.value;
  return {
    ok: true,
    url: enderecoDoFormulario(env().TRIA_APP_BASE_URL, token),
    conviteUrl: escopo.admin ? await urlDoConvite(escopo.comando.organizationId, clientId, link.conviteDeIntegracaoId) : null,
    expiraEm: link.expiraEm.toISOString(),
    secoes: link.secoes,
  };
}

export async function revogarLinkDeContexto(formData: FormData): Promise<void> {
  const clientId = text(formData, 'clientId');
  const destino = rotaDoCliente(clientId, 'acessos');
  const escopo = await escopoDoCliente(clientId);
  const linkId = text(formData, 'linkId');
  if (!escopo || !idValido(linkId)) redirect(comAviso(destino, 'erro', 'Link não encontrado.'));
  const resultado = await modules().contexto.revogarLink({ ...escopo.comando, linkId }, await atorAtual());
  if (!resultado.ok) redirect(comAviso(destino, 'erro', resultado.error.message));
  redirect(comAviso(destino, 'feito', 'Link revogado. Quem tiver o endereço não consegue mais abrir.'));
}
