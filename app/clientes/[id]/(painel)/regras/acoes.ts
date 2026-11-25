'use server';

import { redirect } from 'next/navigation';
import { escopoDoClienteNaOrganizacao } from '@/../app/clientes/[id]/_escopo';
import { modules } from '@/composition';
import {
  lerAlteracao,
  lerDecisaoDeProposta,
  lerRegistro,
  lerRevogacao,
  type CamposBrutos,
} from '@/modules/clients/application/regrasFormulario';
import { comAviso, rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import { atorAtual } from '@/shared/http/ator';
import type { Failure } from '@/shared/result/failure';
import type { Result } from '@/shared/result/result';

export type EstadoDoFormulario = {
  readonly erro?: string;
  readonly campos?: Readonly<Record<string, string>>;
};

const NAO_ENCONTRADO: EstadoDoFormulario = { erro: 'Cliente não encontrado.' };

function camposDo(formData: FormData): CamposBrutos {
  const campos: Record<string, string> = {};
  for (const [chave, valor] of formData.entries()) {
    if (typeof valor === 'string') campos[chave] = valor;
  }
  return campos;
}

function emEstado(falha: Failure): EstadoDoFormulario {
  return falha.details ? { erro: falha.message, campos: falha.details } : { erro: falha.message };
}

function concluir(clienteId: string, secao: string, mensagem: string): never {
  redirect(comAviso(rotaDoCliente(clienteId, 'regras', { secao }), 'feito', mensagem));
}

function falhar(clienteId: string, secao: string, mensagem: string): never {
  redirect(comAviso(rotaDoCliente(clienteId, 'regras', { secao }), 'erro', mensagem));
}

async function resolver<T>(
  clienteId: string,
  resultado: Result<T, Failure>,
  sucesso: { readonly secao: string; readonly mensagem: string },
): Promise<EstadoDoFormulario> {
  if (!resultado.ok) return emEstado(resultado.error);
  return concluir(clienteId, sucesso.secao, sucesso.mensagem);
}

export async function registrarAcao(_anterior: EstadoDoFormulario, formData: FormData): Promise<EstadoDoFormulario> {
  const campos = camposDo(formData);
  const clienteId = campos['clienteId'];
  const escopo = await escopoDoClienteNaOrganizacao(clienteId);
  if (!escopo) return NAO_ENCONTRADO;
  const definicoes = await modules().regras.listarDefinicoes({ organizationId: escopo.comando.organizationId });
  if (!definicoes.ok) return emEstado(definicoes.error);
  const entrada = lerRegistro(campos, definicoes.value);
  if (!entrada.ok) return { erro: 'Corrija os campos indicados.', campos: entrada.error };
  const resultado = await modules().regras.registrar(escopo.comando, entrada.value, await atorAtual());
  return resolver(escopo.cliente.id, resultado, { secao: 'hoje', mensagem: 'Registrado.' });
}

export async function alterarAcao(_anterior: EstadoDoFormulario, formData: FormData): Promise<EstadoDoFormulario> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) return NAO_ENCONTRADO;
  const anterior = await modules().regras.detalhe(escopo.comando, { id: campos['decisaoId'] ?? '' });
  if (!anterior.ok) return emEstado(anterior.error);
  const unidade = anterior.value.natureza === 'limite' ? (anterior.value.valor?.unidade ?? null) : null;
  const entrada = lerAlteracao(campos, unidade);
  if (!entrada.ok) return { erro: 'Corrija os campos indicados.', campos: entrada.error };
  const resultado = await modules().regras.superar(escopo.comando, entrada.value, await atorAtual());
  return resolver(escopo.cliente.id, resultado, { secao: 'hoje', mensagem: 'Alterado: a decisão anterior ficou no histórico como substituída.' });
}

export async function revogarAcao(formData: FormData): Promise<void> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) redirect('/clientes');
  const entrada = lerRevogacao(campos);
  if (!entrada.ok) falhar(escopo.cliente.id, 'hoje', Object.values(entrada.error)[0] ?? 'Dados inválidos.');
  const resultado = await modules().regras.revogar(escopo.comando, entrada.value, await atorAtual());
  if (!resultado.ok) falhar(escopo.cliente.id, 'hoje', resultado.error.message);
  concluir(escopo.cliente.id, 'hoje', 'Revogado.');
}

async function decidirProposta(formData: FormData, aceitar: boolean): Promise<void> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) redirect('/clientes');
  const entrada = lerDecisaoDeProposta(campos, !aceitar);
  if (!entrada.ok) falhar(escopo.cliente.id, 'propostas', Object.values(entrada.error)[0] ?? 'Dados inválidos.');
  const ator = await atorAtual();
  const resultado = aceitar
    ? await modules().regras.efetivarProposta(escopo.comando, entrada.value, ator)
    : await modules().regras.rejeitarProposta(escopo.comando, entrada.value, ator);
  if (!resultado.ok) falhar(escopo.cliente.id, 'propostas', resultado.error.message);
  concluir(escopo.cliente.id, 'propostas', aceitar ? 'Proposta aceita: passou a valer.' : 'Proposta rejeitada.');
}

export async function aceitarPropostaAcao(formData: FormData): Promise<void> {
  return decidirProposta(formData, true);
}

export async function rejeitarPropostaAcao(formData: FormData): Promise<void> {
  return decidirProposta(formData, false);
}
