'use server';

import { redirect } from 'next/navigation';
import { modules } from '@/composition';
import { TESTE_DE_MODELO } from '@/modules/ia/domain/tarefasInternas';
import { requestId, text } from '@/shared/http/actions';
import { atorAtual } from '@/shared/http/ator';
import { requireContext } from '@/shared/http/currentOrganization';
import type { Failure } from '@/shared/result/failure';
import type { Result } from '@/shared/result/result';

export type EstadoDoTeste = {
  readonly erro?: string;
  readonly resultado?: { readonly saudacao: string; readonly tokensDeEntrada: number; readonly tokensDeSaida: number };
};

async function quemConfigura() {
  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  return { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role };
}

function marcaDeEnvio(): string {
  return Math.random().toString(36).slice(2, 8);
}

function voltar(resultado: Result<unknown, Failure>, feito: string): never {
  const destino = resultado.ok ? `feito=${encodeURIComponent(feito)}` : `erro=${encodeURIComponent(resultado.error.message)}`;
  redirect(`/config/ia?${destino}&n=${marcaDeEnvio()}`);
}

export async function guardarChave(formData: FormData): Promise<void> {
  const quem = await quemConfigura();
  const chave = formData.get('chave');
  const resultado = await modules().ia.modelos.guardarChave(quem, text(formData, 'fornecedor'), typeof chave === 'string' ? chave : '', await atorAtual());
  voltar(resultado, 'Chave testada e guardada no cofre.');
}

export async function removerChave(formData: FormData): Promise<void> {
  const quem = await quemConfigura();
  voltar(await modules().ia.modelos.removerChave(quem, text(formData, 'fornecedor'), await atorAtual()), 'Chave removida.');
}

export async function atualizarModelos(formData: FormData): Promise<void> {
  const quem = await quemConfigura();
  voltar(await modules().ia.modelos.atualizarModelos(quem, text(formData, 'fornecedor'), await atorAtual()), 'Lista de modelos atualizada.');
}

export async function escolherModelo(formData: FormData): Promise<void> {
  const quem = await quemConfigura();
  const [fornecedor = '', ...resto] = text(formData, 'escolha').split('|');
  const resultado = await modules().ia.modelos.escolherModelo(quem, text(formData, 'tarefa'), fornecedor, resto.join('|'), await atorAtual());
  voltar(resultado, 'Modelo definido para a tarefa.');
}

export async function ligarOuDesligar(formData: FormData): Promise<void> {
  const quem = await quemConfigura();
  const ligada = text(formData, 'ligada') === 'sim';
  voltar(await modules().ia.modelos.ligarOuDesligar(quem, ligada, await atorAtual()), ligada ? 'IA ligada.' : 'IA desligada.');
}

export async function definirTetos(formData: FormData): Promise<void> {
  const quem = await quemConfigura();
  const tetos = { chamadasPorDia: Number(text(formData, 'chamadasPorDia')), tokensPorDia: Number(text(formData, 'tokensPorDia')) };
  voltar(await modules().ia.modelos.definirTetos(quem, tetos, await atorAtual()), 'Tetos atualizados.');
}

export async function testarModelo(_anterior: EstadoDoTeste, _formData: FormData): Promise<EstadoDoTeste> {
  const quem = await quemConfigura();
  const painel = await modules().ia.modelos.painel(quem);
  if (!painel.ok) return { erro: painel.error.message };
  const resposta = await modules().ia.executor.executar({
    organizationId: quem.organizationId,
    tarefa: TESTE_DE_MODELO,
    dados: {},
    requestId: await requestId(),
  });
  if (!resposta.ok) return { erro: resposta.error.message };
  return {
    resultado: {
      saudacao: resposta.value.saida.saudacao,
      tokensDeEntrada: resposta.value.uso.tokensDeEntrada,
      tokensDeSaida: resposta.value.uso.tokensDeSaida,
    },
  };
}
