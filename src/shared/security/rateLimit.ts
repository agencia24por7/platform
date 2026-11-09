type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const LIMITE_DE_BALDES = 10_000;

export type RateLimitVerdict = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export type RateLimitPedido = { readonly key: string; readonly limit: number };

function recolherVencidos(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function consumeAll(
  pedidos: readonly RateLimitPedido[],
  windowMs: number,
): RateLimitVerdict {
  const now = Date.now();

  let baldesNovos = 0;
  let menorSobra = Number.POSITIVE_INFINITY;
  let maiorEspera = 0;

  for (const pedido of pedidos) {
    const bucket = buckets.get(pedido.key);
    const vivo = bucket && bucket.resetAt > now ? bucket : null;

    if (!vivo) {
      baldesNovos += 1;
      menorSobra = Math.min(menorSobra, pedido.limit - 1);
      continue;
    }

    if (vivo.count >= pedido.limit) {
      maiorEspera = Math.max(maiorEspera, Math.ceil((vivo.resetAt - now) / 1000));
    }
    menorSobra = Math.min(menorSobra, pedido.limit - vivo.count - 1);
  }

  if (maiorEspera > 0) {
    return { allowed: false, remaining: 0, retryAfterSeconds: maiorEspera };
  }

  if (baldesNovos > 0 && buckets.size + baldesNovos > LIMITE_DE_BALDES) {
    recolherVencidos(now);
    if (buckets.size + baldesNovos > LIMITE_DE_BALDES) {
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    }
  }

  for (const pedido of pedidos) {
    const bucket = buckets.get(pedido.key);
    if (bucket && bucket.resetAt > now) bucket.count += 1;
    else buckets.set(pedido.key, { count: 1, resetAt: now + windowMs });
  }

  return {
    allowed: true,
    remaining: Math.max(Math.trunc(menorSobra), 0),
    retryAfterSeconds: 0,
  };
}

export function consume(key: string, limit: number, windowMs: number): RateLimitVerdict {
  return consumeAll([{ key, limit }], windowMs);
}

export function forget(key: string): void {
  buckets.delete(key);
}
