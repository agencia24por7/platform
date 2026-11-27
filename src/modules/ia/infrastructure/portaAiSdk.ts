import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMoonshotAI } from '@ai-sdk/moonshotai';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { APICallError, NoObjectGeneratedError, Output, generateText, isStepCount, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { FerramentaDoPedido, ModeloResolvido, PedidoAoModelo, PortaDeModelo, RespostaDoModelo } from '../application/execucao.ts';
import type { Fornecedor } from '../domain/tarefa.ts';

export type FabricaDeModelo = (modelo: ModeloResolvido) => LanguageModel;

const FABRICAS: Record<Fornecedor, (chave: string) => (id: string) => LanguageModel> = {
  anthropic: (apiKey) => createAnthropic({ apiKey }),
  google: (apiKey) => createGoogleGenerativeAI({ apiKey }),
  openai: (apiKey) => createOpenAI({ apiKey }),
  xai: (apiKey) => createXai({ apiKey }),
  moonshot: (apiKey) => createMoonshotAI({ apiKey }),
};

export const modeloDoFornecedor: FabricaDeModelo = (modelo) => FABRICAS[modelo.fornecedor](modelo.chave)(modelo.modelo);

const TENTATIVAS_EXTRAS = 1;

const MENSAGEM_DE_SAIDA_INVALIDA = 'O modelo devolveu uma resposta fora do formato esperado.';
const PROFUNDIDADE_DA_CAUSA = 5;
const MAXIMO_DE_PROBLEMAS_NO_DETALHE = 3;

type ProblemaDoEsquema = { readonly path?: readonly PropertyKey[]; readonly code?: unknown };

function problemasNaCausa(erro: unknown, profundidade = 0): readonly ProblemaDoEsquema[] {
  if (typeof erro !== 'object' || erro === null || profundidade > PROFUNDIDADE_DA_CAUSA) return [];
  const { issues, cause } = erro as { issues?: unknown; cause?: unknown };
  if (Array.isArray(issues) && issues.length > 0) return issues as ProblemaDoEsquema[];
  return problemasNaCausa(cause, profundidade + 1);
}

function detalheDoEsquema(problemas: readonly ProblemaDoEsquema[]): string {
  if (problemas.length === 0) return '';
  const itens = [
    ...new Set(
      problemas.slice(0, MAXIMO_DE_PROBLEMAS_NO_DETALHE).map((problema) => {
        const caminho = (problema.path ?? []).map(String).join('.').replace(/[^a-z0-9_.]/gi, '').slice(0, 60) || 'raiz';
        const tipo = typeof problema.code === 'string' ? problema.code.replace(/[^a-z_]/gi, '').slice(0, 30) : 'invalido';
        return `${caminho}:${tipo}`;
      }),
    ),
  ];
  return ` [esquema:${itens.join(',')}]`;
}

function saidaInvalida(problemas: readonly ProblemaDoEsquema[]): Failure {
  return failure('validation', `${MENSAGEM_DE_SAIDA_INVALIDA}${detalheDoEsquema(problemas)}`);
}

function falhaDe(erro: unknown): Failure {
  if (NoObjectGeneratedError.isInstance(erro)) return saidaInvalida(problemasNaCausa(erro));
  if (APICallError.isInstance(erro)) {
    if (erro.statusCode === 401 || erro.statusCode === 403) return failure('unauthorized', 'O fornecedor recusou a chave ou o acesso a este modelo.');
    if (erro.statusCode === 404) return failure('not_found', 'O fornecedor não reconhece este modelo.');
    if (erro.statusCode === 429) return failure('rate_limited', 'O fornecedor limitou as chamadas desta chave.');
    return failure('unavailable', 'O fornecedor de modelo não respondeu como esperado.');
  }
  if (erro instanceof Error && (erro.name === 'TimeoutError' || erro.name === 'AbortError')) {
    return failure('unavailable', 'A chamada ao modelo passou do tempo máximo da tarefa.');
  }
  return failure('unavailable', 'A chamada ao modelo falhou.');
}

function ferramentasDoSdk(ferramentas: readonly FerramentaDoPedido[]) {
  return Object.fromEntries(
    ferramentas.map((ferramenta) => [
      ferramenta.nome,
      tool({
        description: ferramenta.descricao,
        inputSchema: ferramenta.entrada,
        execute: (entrada: unknown) => ferramenta.executar(entrada),
      }),
    ]),
  );
}

const ESQUEMA_RECUSADO = /schema|constraint|too many states/i;

function fornecedorRecusouOEsquema(erro: unknown): boolean {
  return APICallError.isInstance(erro) && erro.statusCode === 400 && ESQUEMA_RECUSADO.test(erro.message);
}

function jsonDaResposta(texto: string): unknown {
  const limpo = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(limpo);
}

function sistemaComEsquema(sistema: string, esquema: z.ZodType<unknown>): string | null {
  try {
    return `${sistema}\n\nFormato da resposta: um único objeto JSON, sem texto antes ou depois, que valide contra este JSON Schema:\n${JSON.stringify(z.toJSONSchema(esquema))}`;
  } catch {
    return null;
  }
}

function opcoesComuns<S>(pedido: PedidoAoModelo<S>, fabricar: FabricaDeModelo) {
  return {
    model: fabricar(pedido.modelo),
    prompt: pedido.dados,
    tools: ferramentasDoSdk(pedido.ferramentas),
    stopWhen: isStepCount(pedido.orcamento.passos),
    ...(pedido.ferramentas.length > 0 && pedido.orcamento.passos > 1
      ? { prepareStep: ({ stepNumber }: { stepNumber: number }) => (stepNumber >= pedido.orcamento.passos - 1 ? { toolChoice: 'none' as const } : undefined) }
      : {}),
    maxOutputTokens: pedido.orcamento.tokensDeSaida,
    maxRetries: TENTATIVAS_EXTRAS,
    abortSignal: AbortSignal.timeout(pedido.orcamento.tempoMs),
    ...(pedido.raciocinio ? { reasoning: pedido.raciocinio } : {}),
  };
}

async function gerarEstruturado<S>(pedido: PedidoAoModelo<S>, fabricar: FabricaDeModelo): Promise<RespostaDoModelo<S>> {
  const resposta = await generateText({ ...opcoesComuns(pedido, fabricar), system: pedido.sistema, output: Output.object({ schema: pedido.saida }) });
  return {
    saida: resposta.output,
    uso: { tokensDeEntrada: resposta.usage.inputTokens ?? 0, tokensDeSaida: resposta.usage.outputTokens ?? 0, passos: resposta.steps.length },
  };
}

async function gerarEmJsonLivre<S>(pedido: PedidoAoModelo<S>, fabricar: FabricaDeModelo, sistema: string): Promise<Result<RespostaDoModelo<S>, Failure>> {
  const resposta = await generateText({ ...opcoesComuns(pedido, fabricar), system: sistema });
  let bruto: unknown;
  try {
    bruto = jsonDaResposta(resposta.text);
  } catch {
    return err(failure('validation', `${MENSAGEM_DE_SAIDA_INVALIDA} [esquema:json_invalido]`));
  }
  const validada = pedido.saida.safeParse(bruto);
  if (!validada.success) return err(saidaInvalida(validada.error.issues));
  return ok({
    saida: validada.data,
    uso: { tokensDeEntrada: resposta.usage.inputTokens ?? 0, tokensDeSaida: resposta.usage.outputTokens ?? 0, passos: resposta.steps.length },
  });
}

export function criarPortaAiSdk(fabricar: FabricaDeModelo = modeloDoFornecedor): PortaDeModelo {
  return {
    async gerar(pedido) {
      try {
        return ok(await gerarEstruturado(pedido, fabricar));
      } catch (erro) {
        if (!fornecedorRecusouOEsquema(erro)) return err(falhaDe(erro));
        const sistema = sistemaComEsquema(pedido.sistema, pedido.saida);
        if (sistema === null) return err(falhaDe(erro));
        try {
          return await gerarEmJsonLivre(pedido, fabricar, sistema);
        } catch (segundo) {
          return err(falhaDe(segundo));
        }
      }
    },
  };
}
