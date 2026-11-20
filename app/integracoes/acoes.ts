'use server';

import { redirect } from 'next/navigation';
import { modules } from '@/composition';
import { montarChaveZapi, usaChaveDeApi } from '@/modules/connections/domain/chaveDeApi';
import { isSafeReturnPath } from '@/modules/connections/domain/oauth';
import { concordaComRecurso, temRecursoParaVincular, type Platform } from '@/modules/connections/domain/connection';
import { checkbox, text, toActionState } from '@/shared/http/actions';
import { atorAtual } from '@/shared/http/ator';
import { requireContext } from '@/shared/http/currentOrganization';
import { canAdminister, canOperate } from '@/modules/identity/domain/user';

async function contextoDeConexoes() {
  const contexto = await requireContext();
  if (contexto.clientIds !== null) redirect('/clientes');
  return contexto;
}

function concordar(platform: Platform, masculino: string, feminino: string): string {
  return temRecursoParaVincular(platform) ? concordaComRecurso(platform, masculino, feminino) : masculino;
}

function destinoDoRetorno(formData: FormData): string {
  const pedido = formData.get('voltarPara');
  return typeof pedido === 'string' && isSafeReturnPath(pedido) ? pedido : '/integracoes';
}

export async function aceitarConvite(formData: FormData): Promise<void> {
  const contexto = await contextoDeConexoes();
  const organization = contexto.organization;
  const ator = await atorAtual();
  const destino = destinoDoRetorno(formData);
  const voltar = (aviso: string): never =>
    redirect(`${destino}?aviso=${encodeURIComponent(aviso)}`);

  if (!canAdminister(contexto.role)) {
    voltar('Só quem administra a organização pode alterar vínculos de conta.');
    return;
  }

  const conexaoDaConta = text(formData, 'conexaoDaConta');
  const conviteId = text(formData, 'conviteId');

  const conexoes = await modules().connections.listConnections(organization.id);
  if (!conexoes.some((item) => item.id === conexaoDaConta)) {
    voltar('Autorização não encontrada nesta organização.');
    return;
  }

  const pendentes = await modules().tasks.listRecentes(organization.id);
  const convite = pendentes.find(
    (tarefa) => tarefa.id === conviteId && tarefa.kind === 'mcc_invite' && tarefa.status === 'done',
  );

  if (!convite) {
    voltar('Convite não encontrado ou ainda não chegou ao Google.');
    return;
  }

  await modules().tasks.request({
    organizationId: organization.id,
    connectionId: conexaoDaConta,
    kind: 'mcc_accept',
    managerExternalId: convite.managerExternalId,
    targetExternalId: convite.targetExternalId,
    requestedBy: ator.userId,
  });

  await modules().audit.record({
    organizationId: organization.id,
    actorType: 'user',
    actorId: ator.userId,
    action: 'mcc.accept_requested',
    targetType: 'connection',
    targetId: conexaoDaConta,
    requestId: ator.requestId,
    sourceIp: ator.sourceIp,
    metadata: {
      administradora: convite.managerExternalId,
      conta: convite.targetExternalId,
      conviteId: convite.id,
    },
  });

  voltar('Aceite enfileirado. Ele usa a credencial da conta convidada, como o Google exige.');
}

export async function convidarParaMcc(formData: FormData): Promise<void> {
  const contexto = await contextoDeConexoes();
  const ator = await atorAtual();
  const destino = destinoDoRetorno(formData);
  const voltar = (aviso: string): never =>
    redirect(`${destino}?aviso=${encodeURIComponent(aviso)}`);

  if (!canAdminister(contexto.role)) {
    voltar('Só quem administra a organização pode convidar contas para a MCC.');
    return;
  }

  const administradora = text(formData, 'administradora');
  const alcancaveis = await modules().discoveredAccounts.listAll(contexto.organization.id);

  const conta = alcancaveis.find((item) => item.id === text(formData, 'contaId'));
  if (!conta) {
    voltar('Conta não encontrada nesta organização.');
    return;
  }

  const conexaoDaMcc = alcancaveis.find(
    (item) => item.managerExternalId === administradora && item.externalId !== administradora,
  )?.connectionId;

  if (!conexaoDaMcc) {
    voltar('Não há autorização que alcance essa administradora.');
    return;
  }

  await modules().tasks.request({
    organizationId: contexto.organization.id,
    connectionId: conexaoDaMcc,
    kind: 'mcc_invite',
    managerExternalId: administradora,
    targetExternalId: conta.externalId,
    requestedBy: ator.userId,
  });

  await modules().audit.record({
    organizationId: contexto.organization.id,
    actorType: 'user',
    actorId: ator.userId,
    action: 'mcc.invite_requested',
    targetType: 'connection',
    targetId: conexaoDaMcc,
    requestId: ator.requestId,
    sourceIp: ator.sourceIp,
    metadata: { administradora, conta: conta.externalId },
  });

  voltar(`Convite enviado para ${conta.externalId}. O dono precisa aceitar.`);
}

export async function vincularAlcancavel(formData: FormData): Promise<void> {
  const contexto = await contextoDeConexoes();
  const organization = contexto.organization;
  const ator = await atorAtual();
  const destino = destinoDoRetorno(formData);
  const voltar = (aviso: string): never =>
    redirect(`${destino}?aviso=${encodeURIComponent(aviso)}`);

  if (!canOperate(contexto.role)) {
    voltar('Seu papel não permite vincular contas.');
    return;
  }

  const descobertas = await modules().discoveredAccounts.listPending(organization.id);
  const escolhida = descobertas.find((conta) => conta.id === text(formData, 'contaId'));
  if (!escolhida) {
    voltar('Conta não encontrada entre as que você alcança.');
    return;
  }

  const clientId = text(formData, 'clientId');
  const dono = (await modules().clients.list(organization.id)).find(
    (cliente) => cliente.id === clientId && cliente.status === 'active',
  );
  if (!dono) {
    voltar('Escolha um cliente ativo desta organização. É ele que dá dono ao número.');
    return;
  }

  const vinculada = await modules().connections.linkAccount(
    {
      organizationId: organization.id,
      clientId,
      connectionId: escolhida.connectionId,
      platform: escolhida.platform,
      externalId: escolhida.externalId,
      name: escolhida.name,
      accountGroup: 'Principal',
      currency: escolhida.currency,
      timezone: escolhida.timezone,
      syncEnabled: !checkbox(formData, 'semColeta'),
    },
    ator,
  );

  if (!vinculada.ok) {
    voltar(toActionState(vinculada.error).error ?? 'Falha ao vincular a conta.');
    return;
  }

  await modules().discoveredAccounts.markLinked(organization.id, escolhida.id, vinculada.value.id);
  voltar(`${escolhida.name} vinculada.`);
}

export async function vincularRecurso(formData: FormData): Promise<void> {
  const contexto = await contextoDeConexoes();
  const destino = destinoDoRetorno(formData);

  const resultado = await modules().recursos.vincular(
    {
      organizationId: contexto.organization.id,
      papelDeQuemAge: contexto.role,
      recursoId: text(formData, 'recursoId'),
      clientId: text(formData, 'clientId'),
    },
    await atorAtual(),
  );

  const aviso = resultado.ok
    ? `${resultado.value.name} ${concordar(resultado.value.platform, 'vinculado', 'vinculada')}.`
    : toActionState(resultado.error).error ?? 'Falha ao vincular.';
  redirect(`${destino}?aviso=${encodeURIComponent(aviso)}`);
}

export async function desvincularConta(formData: FormData): Promise<void> {
  const contexto = await contextoDeConexoes();
  const destino = destinoDoRetorno(formData);

  const resultado = await modules().connections.unlinkAccount(
    {
      organizationId: contexto.organization.id,
      papelDeQuemAge: contexto.role,
      accountId: text(formData, 'contaId'),
    },
    await atorAtual(),
  );

  const aviso = resultado.ok
    ? `${resultado.value.name} desvinculada. Sai da coleta e volta para "Conectar conta"; o histórico coletado continua no BigQuery.`
    : toActionState(resultado.error).error ?? 'Falha ao desvincular.';
  redirect(`${destino}?aviso=${encodeURIComponent(aviso)}`);
}

export async function desvincularRecurso(formData: FormData): Promise<void> {
  const contexto = await contextoDeConexoes();
  const destino = destinoDoRetorno(formData);

  const resultado = await modules().recursos.desvincular(
    {
      organizationId: contexto.organization.id,
      papelDeQuemAge: contexto.role,
      recursoId: text(formData, 'recursoId'),
    },
    await atorAtual(),
  );

  const aviso = resultado.ok
    ? `${resultado.value.name} ${concordar(resultado.value.platform, 'desvinculado', 'desvinculada')}. Volta para a lista de recursos sem dono.`
    : toActionState(resultado.error).error ?? 'Falha ao desvincular.';
  redirect(`${destino}?aviso=${encodeURIComponent(aviso)}`);
}

export async function guardarChave(formData: FormData): Promise<void> {
  const contexto = await contextoDeConexoes();
  const ator = await atorAtual();
  const destino = destinoDoRetorno(formData);
  const voltar = (aviso: string): never =>
    redirect(`${destino}?aviso=${encodeURIComponent(aviso)}`);

  const pedida = text(formData, 'plataforma');
  if (!usaChaveDeApi(pedida as Platform)) {
    voltar('Essa plataforma não se conecta por chave de API.');
    return;
  }

  const chave =
    pedida === 'zapi'
      ? montarChaveZapi(text(formData, 'instanceId'), text(formData, 'token'))
      : text(formData, 'chave');

  const resultado = await modules().connections.guardarChave(
    {
      organizationId: contexto.organization.id,
      organizationSlug: contexto.organization.slug,
      papelDeQuemAge: contexto.role,
      platform: pedida as Platform,
      chave,
    },
    ator,
  );

  if (!resultado.ok) {
    voltar(toActionState(resultado.error).error ?? 'Não deu para guardar a chave.');
    return;
  }
  voltar('Chave testada com sucesso e guardada no cofre. O banco ficou só com a referência. Agora escolha logo abaixo o cliente dono dela.');
}

export async function removerConexao(formData: FormData): Promise<void> {
  const contexto = await contextoDeConexoes();
  const ator = await atorAtual();
  const destino = destinoDoRetorno(formData);
  const voltar = (aviso: string): never =>
    redirect(`${destino}?aviso=${encodeURIComponent(aviso)}`);

  if (!canAdminister(contexto.role)) {
    voltar('Só quem administra a organização pode remover uma conexão.');
    return;
  }

  const resultado = await modules().connections.removerConexao(
    {
      organizationId: contexto.organization.id,
      papelDeQuemAge: contexto.role,
      connectionId: text(formData, 'connectionId'),
    },
    ator,
  );

  if (!resultado.ok) {
    voltar(toActionState(resultado.error).error ?? 'Não deu para remover a conexão.');
    return;
  }
  voltar('Conexão removida. A credencial foi apagada do cofre e a coleta dessa conta parou.');
}
