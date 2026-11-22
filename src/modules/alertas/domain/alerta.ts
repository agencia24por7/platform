import { createHash } from 'node:crypto';
import { redactText } from '../../../shared/logging/redact.ts';

export const TAMANHO_MAXIMO_DA_MENSAGEM = 500;
export const TAMANHO_MAXIMO_DO_NOME = 200;
export const JANELA_DE_DEDUPLICACAO_EM_MINUTOS = 60;
export const DIAS_ATE_O_ALERTA_SAIR_DA_CONTAGEM = 7;

export type AlertaRecebido = {
  readonly workflowId: string | null;
  readonly workflowNome: string;
  readonly no: string | null;
  readonly mensagem: string;
};

export type AlertaLimpo = AlertaRecebido & { readonly assinatura: string };

const PARAMETROS_SECRETOS = /\b(access_token|refresh_token|client_secret|developer_token|api_key|apikey|key|token|senha|password|secret)=[^&\s"']+/gi;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const TELEFONE = /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b/g;
const SEQUENCIA_LONGA_DE_DIGITOS = /\b\d{9,}\b/g;

export function limparTexto(texto: string, limite: number): string {
  const semSegredos = redactText(texto)
    .replace(PARAMETROS_SECRETOS, '$1=[redigido]')
    .replace(CPF, '[cpf]')
    .replace(TELEFONE, '[telefone]');
  return semSegredos.replace(/\s+/g, ' ').trim().slice(0, limite);
}

function textoOpcional(valor: string | null, limite: number): string | null {
  if (valor === null) return null;
  const limpo = limparTexto(valor, limite);
  return limpo === '' ? null : limpo;
}

export function assinaturaDoAlerta(workflowNome: string, mensagem: string): string {
  const normalizada = mensagem.replace(SEQUENCIA_LONGA_DE_DIGITOS, '#').toLowerCase();
  return createHash('sha256').update(`${workflowNome.toLowerCase()}\u0000${normalizada}`).digest('hex');
}

export function limparAlerta(recebido: AlertaRecebido): AlertaLimpo {
  const workflowNome = limparTexto(recebido.workflowNome, TAMANHO_MAXIMO_DO_NOME) || 'desconhecido';
  const mensagem = limparTexto(recebido.mensagem, TAMANHO_MAXIMO_DA_MENSAGEM) || 'sem mensagem';
  return {
    workflowId: textoOpcional(recebido.workflowId, 64),
    workflowNome,
    no: textoOpcional(recebido.no, TAMANHO_MAXIMO_DO_NOME),
    mensagem,
    assinatura: assinaturaDoAlerta(workflowNome, mensagem),
  };
}
