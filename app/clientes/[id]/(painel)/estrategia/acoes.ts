'use server';

import { redirect } from 'next/navigation';
import { escopoDoClienteNaOrganizacao } from '@/../app/clientes/[id]/_escopo';
import { modules } from '@/composition';
import { comAviso, rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import {
  lerEdicaoDeSecao,
  lerIdDoCampo,
  lerIntencaoDoFormulario,
  lerPedidoDeMudanca,
  trocarSecao,
  type CamposBrutos,
} from '@/modules/strategy/interface/formulariosDaEstrategia';
import type { MemberRole } from '@/modules/identity/domain/user';
import { atorAtual } from '@/shared/http/ator';
import type { Failure } from '@/shared/result/failure';
import type { Result } from '@/shared/result/result';

export type EstadoDoFormulario = {
  readonly erro?: string;
  readonly campos?: Readonly<Record<string, string>>;
  readonly valores?: Readonly<Record<string, string | undefined>>;
};

const NAO_ENCONTRADO: EstadoDoFormulario = { erro: 'Cliente não encontrado.' };
const LIMITE_DA_MENSAGEM = 400;

function camposDo(formData: FormData): CamposBrutos {
  const campos: Record<string, string> = {};
  for (const [chave, valor] of formData.entries()) {
    if (typeof valor === 'string') campos[chave] = valor;
  }
  return campos;
}

function textoDaFalha(falha: Failure): string {
  const detalhes = falha.code === 'validation' && falha.details ? Object.values(falha.details).join(' ') : '';
  return `${falha.message}${detalhes ? ` ${detalhes}` : ''}`.slice(0, LIMITE_DA_MENSAGEM);
}

function emEstado(falha: Failure, valores: CamposBrutos): EstadoDoFormulario {
  return falha.details ? { erro: falha.message, campos: falha.details, valores } : { erro: falha.message, valores };
}

function concluir(clienteId: string, mensagem: string): never {
  redirect(comAviso(rotaDoCliente(clienteId, 'estrategia', { secao: 'plano' }), 'feito', mensagem));
}

function falhar(clienteId: string, mensagem: string): never {
  redirect(comAviso(rotaDoCliente(clienteId, 'estrategia', { secao: 'plano' }), 'erro', mensagem));
}

type ComandoDaAcao = { readonly organizationId: string; readonly papelDeQuemAge: MemberRole };

async function planoDoCliente(comando: ComandoDaAcao, clientId: string, planoId: string): Promise<boolean> {
  return (await modules().strategy.service.clienteDoPlano(comando, planoId)) === clientId;
}

async function versaoDoCliente(comando: ComandoDaAcao, clientId: string, versaoId: string): Promise<boolean> {
  return (await modules().strategy.service.clienteDaVersao(comando, versaoId)) === clientId;
}

async function execucaoDoCliente(comando: ComandoDaAcao, clientId: string, execucaoId: string): Promise<boolean> {
  return (await modules().strategy.service.clienteDaExecucao(comando, execucaoId)) === clientId;
}

const PLANO_MUDOU: EstadoDoFormulario = { erro: 'O plano mudou enquanto você editava. Recarregue a página.' };

async function resolver<T>(clienteId: string, resultado: Result<T, Failure>, mensagem: string, valores: CamposBrutos): Promise<EstadoDoFormulario> {
  if (!resultado.ok) return emEstado(resultado.error, valores);
  return concluir(clienteId, mensagem);
}

export async function novoPlanoAcao(_anterior: EstadoDoFormulario, formData: FormData): Promise<EstadoDoFormulario> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) return NAO_ENCONTRADO;
  const entrada = lerIntencaoDoFormulario(campos);
  if (!entrada.ok) return { erro: 'Corrija os campos indicados.', campos: entrada.error, valores: campos };
  const resultado = await modules().strategy.service.pedirPlano(
    { organizationId: escopo.comando.organizationId, papelDeQuemAge: escopo.comando.papelDeQuemAge },
    { clienteId: escopo.cliente.id, tipoDePlano: entrada.value.tipoDePlano, intencao: entrada.value.intencao },
    await atorAtual(),
  );
  return resolver(escopo.cliente.id, resultado, 'Plano pedido. O agente está trabalhando; isso leva alguns minutos.', campos);
}

export async function pedirMudancaAcao(_anterior: EstadoDoFormulario, formData: FormData): Promise<EstadoDoFormulario> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) return NAO_ENCONTRADO;
  const entrada = lerPedidoDeMudanca(campos);
  if (!entrada.ok) return { erro: 'Corrija os campos indicados.', campos: entrada.error, valores: campos };
  const comando = { organizationId: escopo.comando.organizationId, papelDeQuemAge: escopo.comando.papelDeQuemAge };
  if (!(await planoDoCliente(comando, escopo.cliente.id, entrada.value.planoId))) return { erro: 'Plano não encontrado.', valores: campos };
  const vista = await modules().strategy.service.versaoVistaDoPlano(comando, { clienteId: escopo.cliente.id, planoId: entrada.value.planoId });
  if (vista?.id !== entrada.value.versaoId) return { ...PLANO_MUDOU, valores: campos };
  const { versaoId: _versaoId, ...pedido } = entrada.value;
  const resultado = await modules().strategy.service.pedirMudanca(comando, pedido, await atorAtual());
  return resolver(escopo.cliente.id, resultado, 'Mudança pedida. O plano volta ao Comitê e aos Gates.', campos);
}

export async function editarSecaoAcao(_anterior: EstadoDoFormulario, formData: FormData): Promise<EstadoDoFormulario> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) return NAO_ENCONTRADO;
  const entrada = lerEdicaoDeSecao(campos);
  if (!entrada.ok) return { erro: 'Corrija o conteúdo da seção.', campos: entrada.error, valores: campos };
  const comando = { organizationId: escopo.comando.organizationId, papelDeQuemAge: escopo.comando.papelDeQuemAge };
  if (!(await planoDoCliente(comando, escopo.cliente.id, entrada.value.planoId))) return { erro: 'Plano não encontrado.', valores: campos };
  const vista = await modules().strategy.service.versaoVistaDoPlano(comando, { clienteId: escopo.cliente.id, planoId: entrada.value.planoId, comConteudo: true });
  if (!vista) return { erro: 'O plano ainda não tem versão para editar.', valores: campos };
  if (vista.id !== entrada.value.versaoId) return { ...PLANO_MUDOU, valores: campos };
  const conteudo = trocarSecao(vista.conteudo, entrada.value.secao, entrada.value.valor);
  if (!conteudo) return { erro: 'O plano guardado está num formato que não permite edição.', valores: campos };
  const resultado = await modules().strategy.service.editarManual(comando, { planoId: entrada.value.planoId, conteudo }, await atorAtual());
  return resolver(escopo.cliente.id, resultado, 'Seção editada. O plano volta ao Comitê e aos Gates.', campos);
}

type CasoDeVersao = 'aplicar' | 'autorizar' | 'rejeitar' | 'revogar' | 'cancelarVersao';

const SUCESSO_POR_CASO: Readonly<Record<CasoDeVersao, string>> = {
  aplicar: 'Plano aplicado: ele aguarda quem autoriza.',
  autorizar: 'Plano autorizado.',
  rejeitar: 'Plano rejeitado.',
  revogar: 'Plano revogado.',
  cancelarVersao: 'Rascunho cancelado.',
};

async function agirNaVersao(formData: FormData, caso: CasoDeVersao): Promise<void> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) redirect('/clientes');
  const versaoId = lerIdDoCampo(campos, 'versaoId');
  if (!versaoId.ok) falhar(escopo.cliente.id, 'Versão inválida.');
  const comando = { organizationId: escopo.comando.organizationId, papelDeQuemAge: escopo.comando.papelDeQuemAge };
  if (!(await versaoDoCliente(comando, escopo.cliente.id, versaoId.value))) falhar(escopo.cliente.id, 'Versão do plano não encontrada.');
  const resultado = await modules().strategy.service[caso](comando, { versaoId: versaoId.value }, await atorAtual());
  if (!resultado.ok) falhar(escopo.cliente.id, textoDaFalha(resultado.error));
  concluir(escopo.cliente.id, SUCESSO_POR_CASO[caso]);
}

export async function aplicarAcao(formData: FormData): Promise<void> {
  return agirNaVersao(formData, 'aplicar');
}

export async function autorizarAcao(formData: FormData): Promise<void> {
  return agirNaVersao(formData, 'autorizar');
}

export async function rejeitarAcao(formData: FormData): Promise<void> {
  return agirNaVersao(formData, 'rejeitar');
}

export async function revogarAcao(formData: FormData): Promise<void> {
  return agirNaVersao(formData, 'revogar');
}

export async function cancelarRascunhoAcao(formData: FormData): Promise<void> {
  return agirNaVersao(formData, 'cancelarVersao');
}

export async function pedirRevisaoAcao(formData: FormData): Promise<void> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) redirect('/clientes');
  const planoId = lerIdDoCampo(campos, 'planoId');
  if (!planoId.ok) falhar(escopo.cliente.id, 'Plano inválido.');
  const comando = { organizationId: escopo.comando.organizationId, papelDeQuemAge: escopo.comando.papelDeQuemAge };
  if (!(await planoDoCliente(comando, escopo.cliente.id, planoId.value))) falhar(escopo.cliente.id, 'Plano não encontrado.');
  const resultado = await modules().strategy.service.pedirRevisao(comando, { planoId: planoId.value }, await atorAtual());
  if (!resultado.ok) falhar(escopo.cliente.id, textoDaFalha(resultado.error));
  concluir(escopo.cliente.id, 'Revisão pedida. O agente está atualizando o plano ao Brain.');
}

export async function cancelarExecucaoAcao(formData: FormData): Promise<void> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) redirect('/clientes');
  const execucaoId = lerIdDoCampo(campos, 'execucaoId');
  if (!execucaoId.ok) falhar(escopo.cliente.id, 'Execução inválida.');
  const comando = { organizationId: escopo.comando.organizationId, papelDeQuemAge: escopo.comando.papelDeQuemAge };
  if (!(await execucaoDoCliente(comando, escopo.cliente.id, execucaoId.value))) falhar(escopo.cliente.id, 'Execução não encontrada.');
  const resultado = await modules().strategy.service.cancelarExecucao(comando, { execucaoId: execucaoId.value }, await atorAtual());
  if (!resultado.ok) falhar(escopo.cliente.id, textoDaFalha(resultado.error));
  concluir(escopo.cliente.id, 'Execução cancelada.');
}
