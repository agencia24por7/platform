import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const HANDOFF_COOKIE = 'tria_portaria';
export const SEM_AUTOMACAO_COOKIE = 'tria_portaria_sem_n8n';
export const SEM_AUTOMACAO_SEGUNDOS = 120;
export const HANDOFF_TTL_SECONDS = 60;
export const HANDOFF_AUDIENCE = 'n8n';
export const PORTARIA_SESSAO_AUDIENCE = 'n8n-sessao';
export const PORTARIA_SESSAO_SEGUNDOS = 8 * 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Payload = {
  readonly userId: string;
  readonly audience: string;
  readonly expiresAt: number;
  readonly jti: string;
};

export type Handoff = {
  readonly userId: string;
  readonly jti: string;
  readonly expiresAt: Date;
};

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function matches(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueHandoff(userId: string, secret: string, now: number): string {
  const payload: Payload = {
    userId,
    audience: HANDOFF_AUDIENCE,
    expiresAt: now + HANDOFF_TTL_SECONDS * 1000,
    jti: randomUUID(),
  };

  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function readHandoff(token: string, secret: string, now: number): Handoff | null {
  const separator = token.lastIndexOf('.');
  if (separator < 1) return null;

  const body = token.slice(0, separator);
  if (!matches(token.slice(separator + 1), sign(body, secret))) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) return null;
  const { userId, audience, expiresAt, jti } = payload as Record<string, unknown>;

  if (audience !== HANDOFF_AUDIENCE) return null;
  if (typeof userId !== 'string' || !UUID.test(userId)) return null;
  if (typeof jti !== 'string' || !UUID.test(jti)) return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  if (expiresAt <= now) return null;
  if (expiresAt - now > HANDOFF_TTL_SECONDS * 1000) return null;

  return { userId, jti, expiresAt: new Date(expiresAt) };
}

export type SessaoDaPortaria = {
  readonly userId: string;
  readonly issuedAt: number;
};

function chaveDaPortaria(secret: string): string {
  return createHmac('sha256', secret).update(PORTARIA_SESSAO_AUDIENCE).digest('hex');
}

export function issuePortariaSession(userId: string, secret: string, now: number): string {
  const payload = {
    userId,
    audience: PORTARIA_SESSAO_AUDIENCE,
    issuedAt: now,
    expiresAt: now + PORTARIA_SESSAO_SEGUNDOS * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, chaveDaPortaria(secret))}`;
}

export function readPortariaSession(token: string, secret: string, now: number): SessaoDaPortaria | null {
  const separator = token.lastIndexOf('.');
  if (separator < 1) return null;

  const body = token.slice(0, separator);
  if (!matches(token.slice(separator + 1), sign(body, chaveDaPortaria(secret)))) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) return null;
  const { userId, audience, issuedAt, expiresAt } = payload as Record<string, unknown>;

  if (audience !== PORTARIA_SESSAO_AUDIENCE) return null;
  if (typeof userId !== 'string' || !UUID.test(userId)) return null;
  if (typeof issuedAt !== 'number' || typeof expiresAt !== 'number') return null;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;
  if (expiresAt <= now) return null;
  if (expiresAt - issuedAt > PORTARIA_SESSAO_SEGUNDOS * 1000) return null;

  return { userId, issuedAt };
}
