import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMoonshotAI } from '@ai-sdk/moonshotai';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { APICallError, NoObjectGeneratedError, Output, generateText, isStepCount, tool, type LanguageModel } from 'ai';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok } from '@/shared/result/result';
import type { FerramentaDoPedido, ModeloResolvido, PortaDeModelo } from '../application/execucao.ts';
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

function falhaDe(erro: unknown): Failure {
  if (NoObjectGeneratedError.isInstance(erro)) return failure('validation', 'O modelo devolveu uma resposta fora do formato esperado.');
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

export function criarPortaAiSdk(fabricar: FabricaDeModelo = modeloDoFornecedor): PortaDeModelo {
  return {
    async gerar(pedido) {
      try {
        const resposta = await generateText({
          model: fabricar(pedido.modelo),
          system: pedido.sistema,
          prompt: pedido.dados,
          output: Output.object({ schema: pedido.saida }),
          tools: ferramentasDoSdk(pedido.ferramentas),
          stopWhen: isStepCount(pedido.orcamento.passos),
          maxOutputTokens: pedido.orcamento.tokensDeSaida,
          maxRetries: TENTATIVAS_EXTRAS,
          abortSignal: AbortSignal.timeout(pedido.orcamento.tempoMs),
        });
        return ok({
          saida: resposta.output,
          uso: {
            tokensDeEntrada: resposta.usage.inputTokens ?? 0,
            tokensDeSaida: resposta.usage.outputTokens ?? 0,
            passos: resposta.steps.length,
          },
        });
      } catch (erro) {
        return err(falhaDe(erro));
      }
    },
  };
}
