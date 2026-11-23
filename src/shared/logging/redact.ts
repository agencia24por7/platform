const SENSITIVE_KEYS = [
  'token',
  'secret',
  'password',
  'passwd',
  'authorization',
  'credential',
  'key',
  'chave',
  'senha',
  'segredo',
  'credencial',
  'cookie',
  'cpf',
  'jwt',
  'signature',
  'assinatura',
];

const MAX_DEPTH = 8;
const MAX_STACK_CHARS = 2000;
const MAX_TEXT_CHARS = 4096;
const FOLGA_DE_REDACAO_CHARS = 4096;
const MAX_NODES = 5000;

type Visita = { readonly seen: WeakSet<object>; restantes: number };

export function redact(input: unknown): unknown {
  return redactNode(input, 0, { seen: new WeakSet<object>(), restantes: MAX_NODES });
}

function redactNode(input: unknown, depth: number, visita: Visita): unknown {
  if (typeof input === 'string') return redactText(input);
  if (typeof input === 'bigint') return input.toString();
  if (typeof input === 'function' || typeof input === 'symbol') return undefined;
  if (input === null || typeof input !== 'object') return input;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.toISOString();
  if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) return '[binario]';
  if (depth >= MAX_DEPTH) return '[profundo]';
  if (visita.seen.has(input)) return '[circular]';
  if (visita.restantes <= 0) return '[truncado]';
  visita.restantes -= 1;

  visita.seen.add(input);
  try {
    if (input instanceof Error) return redactError(input);
    if (Array.isArray(input)) return input.map((item) => redactNode(item, depth + 1, visita));
    return redactObject(input as Record<string, unknown>, depth, visita);
  } finally {
    visita.seen.delete(input);
  }
}

function redactError(error: Error): Record<string, string> {
  const result: Record<string, string> = {
    name: error.name,
    message: redactText(error.message),
  };
  if (error.stack) result['stack'] = redactText(error.stack).slice(0, MAX_STACK_CHARS);
  return result;
}

function redactObject(
  input: Record<string, unknown>,
  depth: number,
  visita: Visita,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (isSensitiveKey(key)) {
      result[key] = '[redigido]';
      continue;
    }
    result[key] = readAndRedact(input, key, depth, visita);
  }
  return result;
}

function readAndRedact(
  input: Record<string, unknown>,
  key: string,
  depth: number,
  visita: Visita,
): unknown {
  try {
    return redactNode(input[key], depth + 1, visita);
  } catch {
    return '[ilegivel]';
  }
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((word) => lower.includes(word));
}

const SECRET_SHAPES = [
  /"(access_token|refresh_token|id_token|client_secret|developer[-_]token)"\s*:\s*"[^"]*(?:"|$)/gi,
  /\b(ya29|1\/\/|GOCSPX-|EAA)[A-Za-z0-9._\-/+]{10,}/g,
  /\bapify_api_[A-Za-z0-9]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._\-~+/=]{8,}/g,
  /(?:(?<![A-Za-z0-9_-])|(?<=%[0-9A-Fa-f]{2}))eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /(?<=[_-])eyJ[A-Za-z0-9_-]{8,512}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

const EMAIL = /\b([A-Za-z0-9])[A-Za-z0-9._%+-]{0,63}@([A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63})\b/g;
const EMAIL_COM_PARTE_LOCAL_LONGA = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{65,}@/g;

type TextoAcompanhado = { readonly texto: string; readonly posicao: number };

function substituir(
  atual: TextoAcompanhado,
  forma: RegExp,
  trocar: (trecho: string, grupos: readonly string[]) => string,
): TextoAcompanhado {
  let deslocamento = 0;
  let posicao = atual.posicao;
  const texto = atual.texto.replace(forma, (trecho: string, ...resto: unknown[]) => {
    const deslocamentoDoTrecho = resto.findIndex((item) => typeof item === 'number');
    const inicio = resto[deslocamentoDoTrecho] as number;
    const grupos = resto.slice(0, deslocamentoDoTrecho) as string[];
    const novo = trocar(trecho, grupos);
    if (inicio + trecho.length <= atual.posicao) {
      deslocamento += novo.length - trecho.length;
      posicao = atual.posicao + deslocamento;
    } else if (inicio < atual.posicao) {
      posicao = inicio + deslocamento + novo.length;
    }
    return novo;
  });
  return { texto, posicao };
}

function trocarSegredo(trecho: string): string {
  return trecho.includes('"') ? trecho.replace(/:\s*"[^"]*(?:"|$)/, ': "[redigido]"') : '[redigido]';
}

export function redactText(input: string): string {
  const foiCortado = input.length > MAX_TEXT_CHARS + FOLGA_DE_REDACAO_CHARS;
  let estado: TextoAcompanhado = {
    texto: input.slice(0, MAX_TEXT_CHARS + FOLGA_DE_REDACAO_CHARS),
    posicao: foiCortado ? MAX_TEXT_CHARS : Number.POSITIVE_INFINITY,
  };
  for (const forma of SECRET_SHAPES) estado = substituir(estado, forma, trocarSegredo);
  estado = substituir(estado, EMAIL_COM_PARTE_LOCAL_LONGA, () => '[redigido]@');
  estado = substituir(estado, EMAIL, (_trecho, [local, dominio]) => `${local}***@${dominio}`);
  return estado.texto.slice(0, Math.min(MAX_TEXT_CHARS, estado.posicao));
}
