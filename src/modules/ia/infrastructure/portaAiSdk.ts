import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMoonshotAI } from '@ai-sdk/moonshotai';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { APICallError, NoObjectGeneratedError, Output, generateText, isStepCount, jsonSchema, tool, type LanguageModel } from 'ai';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { FerramentaDoPedido, ModeloResolvido, PedidoAoModelo, PortaDeModelo, RespostaDoModelo, TelemetriaDaChamada } from '../application/execucao.ts';
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

function saidaInvalida(problemas: readonly ProblemaDoEsquema[], telemetria?: TelemetriaDaChamada): Failure {
  return failure('validation', `${MENSAGEM_DE_SAIDA_INVALIDA}${detalheDoEsquema(problemas)}`, telemetria ? detalhesDaTelemetria(telemetria) : undefined);
}

function saidaTruncada(telemetria: TelemetriaDaChamada): Failure {
  return failure('validation', `${MENSAGEM_DE_SAIDA_INVALIDA}${DETALHE_DE_TRUNCAMENTO}`, detalhesDaTelemetria(telemetria));
}

function falhaDe(erro: unknown, caminho: TelemetriaDaChamada['caminho'], tetoDeSaida: number, recusa?: RecusaDoEsquema): Failure {
  const telemetriaDoErro = (finishReason: unknown, usage: { outputTokens?: number } | undefined) => telemetriaDe(caminho, finishReason, usage?.outputTokens, tetoDeSaida, recusa);
  const detalhes = detalhesDaTelemetria(telemetriaDoErro(undefined, undefined));
  if (NoObjectGeneratedError.isInstance(erro)) {
    const telemetria = telemetriaDoErro(erro.finishReason, erro.usage);
    return erro.finishReason === FINALIZACAO_POR_TAMANHO ? saidaTruncada(telemetria) : saidaInvalida(problemasNaCausa(erro), telemetria);
  }
  if (APICallError.isInstance(erro)) {
    if (erro.statusCode === 401 || erro.statusCode === 403) return failure('unauthorized', 'O fornecedor recusou a chave ou o acesso a este modelo.', detalhes);
    if (erro.statusCode === 404) return failure('not_found', 'O fornecedor não reconhece este modelo.', detalhes);
    if (erro.statusCode === 429) return failure('rate_limited', 'O fornecedor limitou as chamadas desta chave.', detalhes);
    return failure('unavailable', 'O fornecedor de modelo não respondeu como esperado.', detalhes);
  }
  if (erro instanceof Error && (erro.name === 'TimeoutError' || erro.name === 'AbortError')) {
    return failure('unavailable', 'A chamada ao modelo passou do tempo máximo da tarefa.', detalhes);
  }
  return failure('unavailable', 'A chamada ao modelo falhou.', detalhes);
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
const FINALIZACAO_POR_TAMANHO = 'length';
const DETALHE_DE_TRUNCAMENTO = ' [saida:truncada]';

type RecusaDoEsquema = NonNullable<TelemetriaDaChamada['recusaDoEsquema']>;

const RESTRICOES_REMOVIDAS_NO_RELAXADO = new Set([
  'pattern', 'format', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
]);
const TAMANHO_MAXIMO_DO_CACHE_DE_RECUSAS = 200;

function relaxar(no: unknown, mapaDePropriedades = false): unknown {
  if (Array.isArray(no)) return no.map((item) => relaxar(item));
  if (typeof no !== 'object' || no === null) return no;
  const resultado: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(no)) {
    if (!mapaDePropriedades && RESTRICOES_REMOVIDAS_NO_RELAXADO.has(chave)) continue;
    resultado[chave] = relaxar(valor, !mapaDePropriedades && (chave === 'properties' || chave === '$defs' || chave === 'definitions'));
  }
  return resultado;
}

export function esquemaRelaxado(esquema: z.ZodType<unknown>): Record<string, unknown> | null {
  try {
    return relaxar(z.toJSONSchema(esquema, { io: 'input', unrepresentable: 'any' })) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function impressaoDoEsquema(esquema: z.ZodType<unknown>): string | null {
  const relaxado = esquemaRelaxado(esquema);
  return relaxado === null ? null : createHash('sha256').update(JSON.stringify(relaxado)).digest('hex').slice(0, 32);
}

function classeDaRecusa(erro: unknown): RecusaDoEsquema | undefined {
  if (!APICallError.isInstance(erro)) return undefined;
  const palavra = ESQUEMA_RECUSADO.exec(erro.message)?.[0]?.toLowerCase();
  return palavra === 'schema' || palavra === 'constraint' || palavra === 'too many states' ? palavra : undefined;
}

export function extrairJson(texto: string): unknown {
  const inicio = texto.indexOf('{');
  if (inicio < 0) throw new SyntaxError('sem objeto JSON');
  let profundidade = 0;
  let emTexto = false;
  let escapado = false;
  for (let i = inicio; i < texto.length; i += 1) {
    const caractere = texto[i];
    if (emTexto) {
      if (escapado) escapado = false;
      else if (caractere === '\\') escapado = true;
      else if (caractere === '"') emTexto = false;
      continue;
    }
    if (caractere === '"') emTexto = true;
    else if (caractere === '{') profundidade += 1;
    else if (caractere === '}') {
      profundidade -= 1;
      if (profundidade === 0) return JSON.parse(texto.slice(inicio, i + 1));
    }
  }
  throw new SyntaxError('objeto JSON não fechado');
}

function telemetriaDe(
  caminho: TelemetriaDaChamada['caminho'],
  finishReason: unknown,
  tokensDeSaida: number | undefined,
  tetoDeSaida: number,
  recusaDoEsquema: RecusaDoEsquema | undefined,
): TelemetriaDaChamada {
  return {
    caminho,
    finishReason: typeof finishReason === 'string' ? finishReason.replace(/[^a-z_-]/gi, '').slice(0, 30) : 'desconhecido',
    tokensDeSaida: tokensDeSaida ?? 0,
    tetoDeSaida,
    ...(recusaDoEsquema === undefined ? {} : { recusaDoEsquema }),
  };
}

function detalhesDaTelemetria(telemetria: TelemetriaDaChamada): Record<string, string> {
  return {
    caminho: telemetria.caminho,
    finishReason: telemetria.finishReason,
    tokensDeSaida: String(telemetria.tokensDeSaida),
    tetoDeSaida: String(telemetria.tetoDeSaida),
    ...(telemetria.recusaDoEsquema === undefined ? {} : { recusaDoEsquema: telemetria.recusaDoEsquema }),
  };
}

function fornecedorRecusouOEsquema(erro: unknown): boolean {
  return APICallError.isInstance(erro) && erro.statusCode === 400 && ESQUEMA_RECUSADO.test(erro.message);
}

function sistemaComEsquema(sistema: string, esquema: z.ZodType<unknown>): string | null {
  try {
    return `${sistema}\n\nFormato da resposta: um único objeto JSON, sem texto antes ou depois, que valide contra este JSON Schema:\n${JSON.stringify(z.toJSONSchema(esquema))}`;
  } catch {
    return null;
  }
}

const CACHE_DO_PREFIXO_NA_ANTHROPIC = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };

export function entradaComPrefixoEstavel<S>(pedido: Pick<PedidoAoModelo<S>, 'modelo' | 'dados' | 'prefixoEstavel' | 'chaveDeCache'>) {
  const prefixo = pedido.prefixoEstavel ?? 0;
  if (prefixo <= 0 || prefixo >= pedido.dados.length) return { prompt: pedido.dados };
  if (pedido.modelo.fornecedor === 'anthropic') {
    return {
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: pedido.dados.slice(0, prefixo), providerOptions: CACHE_DO_PREFIXO_NA_ANTHROPIC },
            { type: 'text' as const, text: pedido.dados.slice(prefixo) },
          ],
        },
      ],
    };
  }
  if (pedido.modelo.fornecedor === 'openai' && pedido.chaveDeCache !== undefined) {
    return { prompt: pedido.dados, providerOptions: { openai: { promptCacheKey: pedido.chaveDeCache } } };
  }
  return { prompt: pedido.dados };
}

type UsoDoSdk = { readonly inputTokens?: number; readonly outputTokens?: number; readonly inputTokenDetails?: { readonly cacheReadTokens?: number } };

function usoDaResposta(usage: UsoDoSdk | undefined, passos: number) {
  return {
    tokensDeEntrada: usage?.inputTokens ?? 0,
    tokensDeEntradaEmCache: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    tokensDeSaida: usage?.outputTokens ?? 0,
    passos,
  };
}

function opcoesComuns<S>(pedido: PedidoAoModelo<S>, fabricar: FabricaDeModelo) {
  return {
    model: fabricar(pedido.modelo),
    ...entradaComPrefixoEstavel(pedido),
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

type Tentativa<S> = { readonly resposta: RespostaDoModelo<S> } | { readonly falha: Failure };

function esquemaParaOFornecedor<S>(pedido: PedidoAoModelo<S>, relaxado: Record<string, unknown> | null) {
  if (relaxado === null) return pedido.saida;
  return jsonSchema<S>(relaxado, {
    validate: (valor) => {
      const lida = pedido.saida.safeParse(valor);
      return lida.success ? { success: true as const, value: lida.data } : { success: false as const, error: lida.error };
    },
  });
}

async function gerarEstruturado<S>(pedido: PedidoAoModelo<S>, fabricar: FabricaDeModelo, relaxado: Record<string, unknown> | null = null, recusa?: RecusaDoEsquema): Promise<RespostaDoModelo<S>> {
  const caminho = relaxado === null ? 'estruturado' : 'estruturado_relaxado';
  const resposta = await generateText({ ...opcoesComuns(pedido, fabricar), system: pedido.sistema, output: Output.object({ schema: esquemaParaOFornecedor(pedido, relaxado) }) });
  const tokensDeSaida = resposta.usage.outputTokens ?? 0;
  return {
    saida: resposta.output,
    uso: usoDaResposta(resposta.usage, resposta.steps.length),
    telemetria: telemetriaDe(caminho, resposta.finishReason, tokensDeSaida, pedido.orcamento.tokensDeSaida, recusa),
  };
}

async function gerarEmJsonLivre<S>(pedido: PedidoAoModelo<S>, fabricar: FabricaDeModelo, sistema: string, recusa: RecusaDoEsquema | undefined): Promise<Tentativa<S>> {
  const teto = pedido.orcamento.tokensDeSaida;
  let texto: string;
  let finishReason: unknown;
  let usage: UsoDoSdk | undefined;
  let passos = 1;
  try {
    const resposta = await generateText({ ...opcoesComuns(pedido, fabricar), system: sistema, output: Output.json() });
    texto = resposta.text;
    finishReason = resposta.finishReason;
    usage = resposta.usage;
    passos = resposta.steps.length;
  } catch (erro) {
    if (!NoObjectGeneratedError.isInstance(erro)) throw erro;
    texto = erro.text ?? '';
    finishReason = erro.finishReason;
    usage = erro.usage;
  }
  const telemetria = telemetriaDe('json_livre', finishReason, usage?.outputTokens, teto, recusa);
  if (finishReason === FINALIZACAO_POR_TAMANHO) return { falha: saidaTruncada(telemetria) };
  let bruto: unknown;
  try {
    bruto = extrairJson(texto);
  } catch {
    return { falha: failure('validation', `${MENSAGEM_DE_SAIDA_INVALIDA} [esquema:json_invalido]`, detalhesDaTelemetria(telemetria)) };
  }
  const validada = pedido.saida.safeParse(bruto);
  if (!validada.success) return { falha: saidaInvalida(validada.error.issues, telemetria) };
  return {
    resposta: {
      saida: validada.data,
      uso: usoDaResposta(usage, passos),
      telemetria,
    },
  };
}

export function criarPortaAiSdk(fabricar: FabricaDeModelo = modeloDoFornecedor): PortaDeModelo {
  const completoRecusado = new Map<string, RecusaDoEsquema | undefined>();
  const lembrarRecusa = (chave: string | null, recusa: RecusaDoEsquema | undefined) => {
    if (chave === null) return;
    if (completoRecusado.size >= TAMANHO_MAXIMO_DO_CACHE_DE_RECUSAS) completoRecusado.delete(completoRecusado.keys().next().value as string);
    completoRecusado.set(chave, recusa);
  };

  return {
    async gerar(pedido) {
      const teto = pedido.orcamento.tokensDeSaida;
      const impressao = impressaoDoEsquema(pedido.saida);
      const chave = impressao === null ? null : `${pedido.modelo.fornecedor}|${pedido.modelo.modelo}|${impressao}`;
      const relaxado = esquemaRelaxado(pedido.saida);
      let recusa: RecusaDoEsquema | undefined;
      let recusado = false;

      if (chave !== null && completoRecusado.has(chave)) {
        recusado = true;
        recusa = completoRecusado.get(chave);
      } else {
        try {
          return ok(await gerarEstruturado(pedido, fabricar));
        } catch (erro) {
          if (!fornecedorRecusouOEsquema(erro)) return err(falhaDe(erro, 'estruturado', teto));
          recusa = classeDaRecusa(erro);
          lembrarRecusa(chave, recusa);
          recusado = true;
        }
      }

      if (recusado && relaxado !== null) {
        try {
          return ok(await gerarEstruturado(pedido, fabricar, relaxado, recusa));
        } catch (erro) {
          if (!fornecedorRecusouOEsquema(erro)) return err(falhaDe(erro, 'estruturado_relaxado', teto, recusa));
        }
      }

      const sistema = sistemaComEsquema(pedido.sistema, pedido.saida);
      if (sistema === null) return err(falhaDe(new Error('sem esquema'), 'json_livre', teto, recusa));
      try {
        const tentativa = await gerarEmJsonLivre(pedido, fabricar, sistema, recusa);
        return 'resposta' in tentativa ? ok(tentativa.resposta) : err(tentativa.falha);
      } catch (segundo) {
        return err(falhaDe(segundo, 'json_livre', teto, recusa));
      }
    },
  };
}
