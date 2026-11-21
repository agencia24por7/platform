'use server';

import { redirect } from 'next/navigation';
import { modules } from '@/composition';
import { comAviso, enderecoDoConvite, enderecoDoFormulario, idValido, rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import { env } from '@/shared/config/env';
import { text } from '@/shared/http/actions';
import { atorAtual } from '@/shared/http/ator';
import { requireContext } from '@/shared/http/currentOrganization';
import { canAdminister } from '@/modules/identity/domain/user';
import { MOTIVO_DO_CONVITE_DE_INTEGRACAO, validarPlataformasEscolhidas } from '@/modules/connections/domain/integrationInvite';

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

export type PedidoAoCliente = {
  readonly plataformas: readonly string[];
  readonly incluirMapa: boolean;
  readonly secoes: readonly string[];
  readonly expiraEmDias: number;
  readonly nota: string;
  readonly conviteDeIntegracaoId: string | null;
};

async function criarConviteParaOPedido(escopo: NonNullable<Awaited<ReturnType<typeof escopoDoCliente>>>, clientId: string, plataformas: readonly string[]) {
  if (!escopo.admin || escopo.ctx.clientIds !== null) {
    return { ok: false as const, erro: 'Só quem administra a organização pode criar convite de integração.' };
  }
  const decisao = validarPlataformasEscolhidas([...plataformas]);
  if (!decisao.ok) return { ok: false as const, erro: MOTIVO_DO_CONVITE_DE_INTEGRACAO[decisao.motivo] };
  const ator = await atorAtual();
  const convite = await modules().connectionInvites.create({
    organizationId: escopo.comando.organizationId,
    clientId,
    platforms: decisao.platforms,
    createdBy: ator.userId,
  });
  await modules().audit.record({
    organizationId: escopo.comando.organizationId,
    actorType: 'user',
    actorId: ator.userId,
    action: 'integration_invite.created',
    targetType: 'client',
    targetId: clientId,
    requestId: ator.requestId,
    sourceIp: ator.sourceIp,
    metadata: { inviteId: convite.id, platforms: decisao.platforms },
  });
  return { ok: true as const, conviteId: convite.id, expiraEm: convite.expiresAt };
}

export async function criarPedidoAoCliente(clientId: string, pedido: PedidoAoCliente): Promise<LinkGerado> {
  const escopo = await escopoDoCliente(clientId);
  if (!escopo) return { ok: false, erro: 'Cliente não encontrado.' };
  let conviteId = pedido.conviteDeIntegracaoId;
  let expiraEm: Date | null = null;
  if (pedido.plataformas.length > 0) {
    const criado = await criarConviteParaOPedido(escopo, clientId, pedido.plataformas);
    if (!criado.ok) return criado;
    conviteId = criado.conviteId;
    expiraEm = criado.expiraEm;
  }
  if (!pedido.incluirMapa) {
    const url = await urlDoConvite(escopo.comando.organizationId, clientId, conviteId);
    if (!url || !expiraEm) return { ok: false, erro: 'Escolha ao menos uma plataforma ou inclua o contexto.' };
    return { ok: true, url, conviteUrl: url, expiraEm: expiraEm.toISOString(), secoes: [] };
  }
  const gerado = await criarLinkDeContexto(clientId, {
    secoes: pedido.secoes,
    expiraEmDias: pedido.expiraEmDias,
    nota: pedido.nota,
    conviteDeIntegracaoId: conviteId,
  });
  if (!gerado.ok && pedido.plataformas.length > 0 && conviteId) {
    await modules().connectionInvites.revoke(escopo.comando.organizationId, conviteId);
  }
  return gerado;
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
  const destino = rotaDoCliente(clientId, 'conexoes', { secao: 'pedir' });
  const escopo = await escopoDoCliente(clientId);
  const linkId = text(formData, 'linkId');
  if (!escopo || !idValido(linkId)) redirect(comAviso(destino, 'erro', 'Link não encontrado.'));
  const resultado = await modules().contexto.revogarLink({ ...escopo.comando, linkId }, await atorAtual());
  if (!resultado.ok) redirect(comAviso(destino, 'erro', resultado.error.message));
  redirect(comAviso(destino, 'feito', 'Link revogado. Quem tiver o endereço não consegue mais abrir.'));
}
