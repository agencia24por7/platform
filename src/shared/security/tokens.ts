import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';

export function secureCompare(candidate: string, expected: string): boolean {
  const left = createHash('sha256').update(candidate).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function newRequestId(): string {
  return randomUUID();
}
