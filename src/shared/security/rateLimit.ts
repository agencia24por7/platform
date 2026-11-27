import { logger } from '../logging/logger.ts';

export const DOMINIOS_DE_LIMITE = ['worker', 'cofre', 'alertas', 'ip', 'webhook', 'publico', 'relato', 'validadas', 'recusadas', 'ia'] as const;

export type DominioDeLimite = (typeof DOMINIOS_DE_LIMITE)[number];

export const TETO_POR_DOMINIO: Readonly<Record<DominioDeLimite, number>> = {
  worker: 10_000,
  cofre: 10_000,
  alertas: 100,
  ip: 20_000,
  webhook: 10_000,
  publico: 10_000,
  relato: 100,
  validadas: 50_000,
  recusadas: 50_000,
  ia: 10_000,
};

const INTERVALO_DO_AVISO_DE_LOTACAO_MS = 60_000;

export type RateLimitVerdict = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export type RateLimitPedido = {
  readonly dominio: DominioDeLimite;
  readonly key: string;
  readonly limit: number;
};

export type OpcoesDoLimitador = {
  readonly tetos?: Partial<Readonly<Record<DominioDeLimite, number>>>;
  readonly agora?: () => number;
  readonly aoLotar?: (dominio: DominioDeLimite) => void;
  readonly intervaloDoAvisoMs?: number;
};

export type LimitadorDeTaxa = {
  readonly consume: (dominio: DominioDeLimite, key: string, limit: number, windowMs: number) => RateLimitVerdict;
  readonly consumeAll: (pedidos: readonly RateLimitPedido[], windowMs: number) => RateLimitVerdict;
  readonly existe: (dominio: DominioDeLimite, key: string) => boolean;
  readonly renovar: (dominio: DominioDeLimite, key: string, windowMs: number) => void;
  readonly cobrarComRecibo: (
    dominio: DominioDeLimite,
    key: string,
    limit: number,
    windowMs: number,
  ) => { readonly veredito: RateLimitVerdict; readonly recibo: ReciboDeCobranca | null };
  readonly devolver: (recibo: ReciboDeCobranca) => void;
  readonly forget: (dominio: DominioDeLimite, key: string) => void;
  readonly tamanho: (dominio: DominioDeLimite) => number;
};

type Bucket = { count: number; resetAt: number; readonly serie: number };

export type ReciboDeCobranca = {
  readonly dominio: DominioDeLimite;
  readonly key: string;
  readonly serie: number;
};

function tetoValido(dominio: DominioDeLimite, teto: number): number {
  if (!Number.isInteger(teto) || teto < 1) {
    throw new RangeError(`Teto do domínio ${dominio} precisa ser inteiro positivo.`);
  }
  return teto;
}

function resolverTetos(tetos: OpcoesDoLimitador['tetos']): Readonly<Record<DominioDeLimite, number>> {
  const resolvidos = { ...TETO_POR_DOMINIO };
  for (const dominio of DOMINIOS_DE_LIMITE) {
    resolvidos[dominio] = tetoValido(dominio, tetos?.[dominio] ?? TETO_POR_DOMINIO[dominio]);
  }
  return resolvidos;
}

function criarMapas(): Readonly<Record<DominioDeLimite, Map<string, Bucket>>> {
  const mapas = {} as Record<DominioDeLimite, Map<string, Bucket>>;
  for (const dominio of DOMINIOS_DE_LIMITE) mapas[dominio] = new Map();
  return mapas;
}

export function criarLimitadorDeTaxa(opcoes: OpcoesDoLimitador = {}): LimitadorDeTaxa {
  const agora = opcoes.agora ?? Date.now;
  const intervaloDoAviso = opcoes.intervaloDoAvisoMs ?? INTERVALO_DO_AVISO_DE_LOTACAO_MS;
  const tetos = resolverTetos(opcoes.tetos);
  const mapas = criarMapas();
  const ultimoAviso = new Map<DominioDeLimite, number>();

  function avisarLotacao(dominio: DominioDeLimite, instante: number): void {
    const anterior = ultimoAviso.get(dominio);
    if (anterior !== undefined && instante - anterior < intervaloDoAviso) return;
    ultimoAviso.set(dominio, instante);
    opcoes.aoLotar?.(dominio);
  }

  function despejarMaisAntigo(dominio: DominioDeLimite, instante: number): void {
    const mapa = mapas[dominio];
    const primeira = mapa.keys().next();
    if (primeira.done) return;
    const despejado = mapa.get(primeira.value);
    mapa.delete(primeira.value);
    if (despejado && despejado.resetAt > instante) avisarLotacao(dominio, instante);
  }

  function baldeVivo(pedido: RateLimitPedido, instante: number): Bucket | null {
    const mapa = mapas[pedido.dominio];
    const bucket = mapa.get(pedido.key);
    if (!bucket) return null;
    mapa.delete(pedido.key);
    if (bucket.resetAt <= instante) return null;
    mapa.set(pedido.key, bucket);
    return bucket;
  }

  let serieDoProximoBalde = 0;
  const recibosDevolvidos = new WeakSet<ReciboDeCobranca>();

  function abrirBalde(pedido: RateLimitPedido, resetAt: number, instante: number): void {
    const mapa = mapas[pedido.dominio];
    while (mapa.size >= tetos[pedido.dominio]) despejarMaisAntigo(pedido.dominio, instante);
    serieDoProximoBalde += 1;
    mapa.set(pedido.key, { count: 1, resetAt, serie: serieDoProximoBalde });
  }

  function cobrar(pedido: RateLimitPedido, windowMs: number, instante: number): void {
    const bucket = mapas[pedido.dominio].get(pedido.key);
    if (bucket && bucket.resetAt > instante) bucket.count += 1;
    else abrirBalde(pedido, instante + windowMs, instante);
  }

  function consumeAll(pedidos: readonly RateLimitPedido[], windowMs: number): RateLimitVerdict {
    const instante = agora();
    let menorSobra = Number.POSITIVE_INFINITY;
    let maiorEspera = 0;

    for (const pedido of pedidos) {
      const vivo = baldeVivo(pedido, instante);
      if (!vivo) {
        menorSobra = Math.min(menorSobra, pedido.limit - 1);
        continue;
      }
      if (vivo.count >= pedido.limit) {
        maiorEspera = Math.max(maiorEspera, Math.ceil((vivo.resetAt - instante) / 1000));
      }
      menorSobra = Math.min(menorSobra, pedido.limit - vivo.count - 1);
    }

    if (maiorEspera > 0) return { allowed: false, remaining: 0, retryAfterSeconds: maiorEspera };

    for (const pedido of pedidos) cobrar(pedido, windowMs, instante);

    return { allowed: true, remaining: Math.max(Math.trunc(menorSobra), 0), retryAfterSeconds: 0 };
  }

  function existe(dominio: DominioDeLimite, key: string): boolean {
    return baldeVivo({ dominio, key, limit: 1 }, agora()) !== null;
  }

  function renovar(dominio: DominioDeLimite, key: string, windowMs: number): void {
    const instante = agora();
    mapas[dominio].delete(key);
    abrirBalde({ dominio, key, limit: 1 }, instante + windowMs, instante);
  }

  function cobrarComRecibo(
    dominio: DominioDeLimite,
    key: string,
    limit: number,
    windowMs: number,
  ): { readonly veredito: RateLimitVerdict; readonly recibo: ReciboDeCobranca | null } {
    const veredito = consumeAll([{ dominio, key, limit }], windowMs);
    const bucket = veredito.allowed ? mapas[dominio].get(key) : undefined;
    return { veredito, recibo: bucket ? { dominio, key, serie: bucket.serie } : null };
  }

  function devolver(recibo: ReciboDeCobranca): void {
    if (recibosDevolvidos.has(recibo)) return;
    recibosDevolvidos.add(recibo);
    const vivo = baldeVivo({ dominio: recibo.dominio, key: recibo.key, limit: 1 }, agora());
    if (vivo && vivo.serie === recibo.serie && vivo.count > 0) vivo.count -= 1;
  }

  return {
    consumeAll,
    existe,
    renovar,
    cobrarComRecibo,
    devolver,
    consume: (dominio, key, limit, windowMs) => consumeAll([{ dominio, key, limit }], windowMs),
    forget: (dominio, key) => {
      mapas[dominio].delete(key);
    },
    tamanho: (dominio) => mapas[dominio].size,
  };
}

const limitadorDoProcesso = criarLimitadorDeTaxa({
  aoLotar: (dominio) => logger.warn('ratelimit.lotado', { dominio }),
});

export const consumeAll = limitadorDoProcesso.consumeAll;
export const consume = limitadorDoProcesso.consume;
export const forget = limitadorDoProcesso.forget;
export const existe = limitadorDoProcesso.existe;
export const renovar = limitadorDoProcesso.renovar;
export const devolver = limitadorDoProcesso.devolver;
export const cobrarComRecibo = limitadorDoProcesso.cobrarComRecibo;
