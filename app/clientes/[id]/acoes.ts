'use server';

import { redirect } from 'next/navigation';
import { modules } from '@/composition';
import {
  MOTIVO_DO_PEDIDO_DE_PARTNER,
  normalizarContaDeAnuncioMeta,
} from '@/modules/connections/domain/metaPartner';
import { text } from '@/shared/http/actions';
import { atorAtual } from '@/shared/http/ator';
import { requireContext } from '@/shared/http/currentOrganization';
import { canAdminister } from '@/modules/identity/domain/user';

async function contextoDoCliente() {
  const contexto = await requireContext();
  if (contexto.clientIds !== null) redirect('/clientes');
  return contexto;
}

async function clienteDaOrganizacao(organizationId: string, clientId: string) {
  const cliente = await modules().clients.byId(organizationId, clientId);
  return cliente.ok ? cliente.value : null;
}

export async function revogarConviteDeIntegracao(formData: FormData): Promise<void> {
  const clientId = text(formData, 'clientId');
  const contexto = await contextoDoCliente();
  const organization = contexto.organization;
  const ator = await atorAtual();

  if (!canAdminister(contexto.role)) {
    redirect(
      `/clientes/${clientId}/conexoes?secao=pedir&erro=${encodeURIComponent('Só quem administra a organização pode revogar um convite.')}`,
    );
  }

  const inviteId = text(formData, 'inviteId');
  const revogado = await modules().connectionInvites.revoke(organization.id, inviteId);
  if (!revogado) {
    redirect(`/clientes/${clientId}/conexoes?secao=pedir&erro=${encodeURIComponent('Convite não encontrado ou já concluído.')}`);
  }

  await modules().audit.record({
    organizationId: organization.id,
    actorType: 'user',
    actorId: ator.userId,
    action: 'integration_invite.revoked',
    targetType: 'client',
    targetId: revogado.clientId,
    requestId: ator.requestId,
    sourceIp: ator.sourceIp,
    metadata: { inviteId },
  });

  redirect(`/clientes/${revogado.clientId}/conexoes?secao=pedir&feito=${encodeURIComponent('Convite revogado.')}`);
}

export async function pedirAcessoMetaPartner(formData: FormData): Promise<void> {
  const clientId = text(formData, 'clientId');
  const contexto = await contextoDoCliente();
  const organization = contexto.organization;
  const ator = await atorAtual();
  const voltar = (aviso: string): never =>
    redirect(`/clientes/${clientId}/conexoes?secao=pedir&erro=${encodeURIComponent(aviso)}`);

  if (!canAdminister(contexto.role)) {
    voltar('Só quem administra a organização pode pedir acesso parceiro no Meta.');
    return;
  }

  if (!(await clienteDaOrganizacao(organization.id, clientId))) {
    voltar('Cliente não encontrado nesta organização.');
    return;
  }

  const contaDeAnuncio = normalizarContaDeAnuncioMeta(text(formData, 'contaDeAnuncio'));
  if (!contaDeAnuncio) {
    voltar(MOTIVO_DO_PEDIDO_DE_PARTNER.formato);
    return;
  }

  const organizacao = await modules().organizations.byId(organization.id);
  if (!organizacao.ok || !organizacao.value.businessManagerId) {
    voltar(MOTIVO_DO_PEDIDO_DE_PARTNER.sem_business_manager);
    return;
  }

  const conexoes = await modules().connections.listConnections(organization.id);
  const conexaoMeta = conexoes.find(
    (conexao) =>
      conexao.platform === 'meta' && conexao.grantType === 'oauth_user' && conexao.authorizedVia === 'staff',
  );
  if (!conexaoMeta) {
    voltar(MOTIVO_DO_PEDIDO_DE_PARTNER.sem_conexao_meta);
    return;
  }

  await modules().tasks.request({
    organizationId: organization.id,
    connectionId: conexaoMeta.id,
    kind: 'bm_partner_request',
    managerExternalId: organizacao.value.businessManagerId,
    targetExternalId: contaDeAnuncio,
    requestedBy: ator.userId,
    clientId,
  });

  await modules().audit.record({
    organizationId: organization.id,
    actorType: 'user',
    actorId: ator.userId,
    action: 'meta.partner_requested',
    targetType: 'client',
    targetId: clientId,
    requestId: ator.requestId,
    sourceIp: ator.sourceIp,
    metadata: { businessManagerId: organizacao.value.businessManagerId, contaDeAnuncio },
  });

  redirect(`/clientes/${clientId}/conexoes?secao=pedir&feito=${encodeURIComponent('Pedido de acesso enviado para a fila.')}`);
}
