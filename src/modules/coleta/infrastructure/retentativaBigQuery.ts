const MENSAGENS_TRANSITORIAS = [
  /could not serialize access/i,
  /concurrent update/i,
  /transaction (is )?aborted/i,
  /aborted due to concurrent/i,
  /too many dml statements/i,
  /exceeded rate limits/i,
];

const MOTIVOS_TRANSITORIOS = new Set(['rateLimitExceeded', 'jobRateLimitExceeded', 'backendError']);

const CODIGOS_HTTP_TRANSITORIOS = new Set([429, 503]);

type ErroDoBigQuery = {
  readonly message?: unknown;
  readonly code?: unknown;
  readonly errors?: readonly { readonly reason?: unknown; readonly message?: unknown }[];
};

export function erroTransitorioDoBigQuery(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) return false;
  const { message, code, errors } = erro as ErroDoBigQuery;
  const mensagens = [message, ...(Array.isArray(errors) ? errors.map((item) => item?.message) : [])]
    .filter((texto): texto is string => typeof texto === 'string');
  if (mensagens.some((texto) => MENSAGENS_TRANSITORIAS.some((padrao) => padrao.test(texto)))) return true;
  if (Array.isArray(errors) && errors.some((item) => typeof item?.reason === 'string' && MOTIVOS_TRANSITORIOS.has(item.reason))) {
    return true;
  }
  return typeof code === 'number' && CODIGOS_HTTP_TRANSITORIOS.has(code);
}

export type PoliticaDeRetentativa = {
  readonly tentativas: number;
  readonly esperaBaseMs: number;
  readonly esperaMaximaMs: number;
};

export const POLITICA_PADRAO: PoliticaDeRetentativa = { tentativas: 4, esperaBaseMs: 500, esperaMaximaMs: 8_000 };

export function esperaDaTentativa(tentativa: number, politica: PoliticaDeRetentativa, aleatorio: () => number): number {
  const teto = Math.min(politica.esperaMaximaMs, politica.esperaBaseMs * 2 ** (tentativa - 1));
  return Math.round(teto / 2 + aleatorio() * (teto / 2));
}

export type Ambiente = {
  readonly dormir: (ms: number) => Promise<void>;
  readonly aleatorio: () => number;
  readonly aoRetentar?: (tentativa: number, erro: unknown) => void;
};

export const ambienteReal = (aoRetentar?: Ambiente['aoRetentar']): Ambiente => ({
  dormir: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
  aleatorio: Math.random,
  aoRetentar,
});

export async function comRetentativa<T>(
  operacao: () => Promise<T>,
  politica: PoliticaDeRetentativa = POLITICA_PADRAO,
  ambiente: Ambiente = ambienteReal(),
): Promise<T> {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await operacao();
    } catch (erro) {
      if (tentativa >= politica.tentativas || !erroTransitorioDoBigQuery(erro)) throw erro;
      ambiente.aoRetentar?.(tentativa, erro);
      await ambiente.dormir(esperaDaTentativa(tentativa, politica, ambiente.aleatorio));
    }
  }
}
