import { createHmac, timingSafeEqual } from 'node:crypto';

import { SESSION_MAX_AGE_SECONDS } from './sessionCookie.ts';

export { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from './sessionCookie.ts';

export type SessionPayload = {
  readonly userId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function signaturesMatch(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueSession(userId: string, secret: string, now: number): string {
  const payload: SessionPayload = {
    userId,
    issuedAt: now,
    expiresAt: now + SESSION_MAX_AGE_SECONDS * 1000,
  };

  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function readSession(token: string, secret: string, now: number): SessionPayload | null {
  const separator = token.lastIndexOf('.');
  if (separator < 1) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!signaturesMatch(signature, sign(body, secret))) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) return null;

  const { userId, issuedAt, expiresAt } = payload as Record<string, unknown>;
  if (typeof userId !== 'string' || !UUID.test(userId)) return null;
  if (typeof issuedAt !== 'number' || typeof expiresAt !== 'number') return null;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;
  if (expiresAt <= now) return null;
  if (expiresAt - issuedAt > SESSION_MAX_AGE_SECONDS * 1000) return null;

  return { userId, issuedAt, expiresAt };
}
