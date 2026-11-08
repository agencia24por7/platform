import { createHmac, timingSafeEqual } from 'node:crypto';

export const HANDOFF_COOKIE = 'tria_portaria';
export const HANDOFF_TTL_SECONDS = 60;
export const HANDOFF_AUDIENCE = 'n8n';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Payload = {
  readonly userId: string;
  readonly audience: string;
  readonly expiresAt: number;
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
  };

  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function readHandoff(token: string, secret: string, now: number): string | null {
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
  const { userId, audience, expiresAt } = payload as Record<string, unknown>;

  if (audience !== HANDOFF_AUDIENCE) return null;
  if (typeof userId !== 'string' || !UUID.test(userId)) return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  if (expiresAt <= now) return null;
  if (expiresAt - now > HANDOFF_TTL_SECONDS * 1000) return null;

  return userId;
}
