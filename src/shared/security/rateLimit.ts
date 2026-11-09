type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const LIMITE_DE_BALDES = 10_000;

function recolherVencidos(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  if (buckets.size < LIMITE_DE_BALDES) return;

  const sobra = buckets.size - LIMITE_DE_BALDES + 1;
  let removidos = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    removidos += 1;
    if (removidos >= sobra) break;
  }
}

export type RateLimitVerdict = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export function consume(key: string, limit: number, windowMs: number): RateLimitVerdict {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= LIMITE_DE_BALDES) recolherVencidos(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

export function forget(key: string): void {
  buckets.delete(key);
}
