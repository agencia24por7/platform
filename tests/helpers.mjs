import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const BASE = 'http://localhost:3000';

export function env() {
  return Object.fromEntries(
    readFileSync('.env', 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

export function workerHeaders() {
  return { Authorization: `Bearer ${env().TRIA_WORKER_TOKEN}`, 'Content-Type': 'application/json' };
}

export async function appIsUp() {
  try {
    const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

const SESSION_COOKIE = 'tria_sessao';

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'tria-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')[0]
    .trim();
}

export function ensureUser(email = 'teste@tria.local') {
  psql(
    `INSERT INTO core.users (email, name) VALUES ('${email}', 'Teste')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name`,
  );
  return psql(`SELECT id FROM core.users WHERE email = '${email}'`);
}

export function makeOwner(userId, organizationId) {
  psql(
    `INSERT INTO core.members (organization_id, user_id, role)
     VALUES ('${organizationId}', '${userId}', 'owner')
     ON CONFLICT (organization_id, user_id) DO NOTHING`,
  );
}

export function sessionCookie(userId) {
  const now = Date.now();
  const body = Buffer.from(
    JSON.stringify({ userId, issuedAt: now, expiresAt: now + 3600_000 }),
  ).toString('base64url');
  const signature = createHmac('sha256', env().TRIA_SESSION_SECRET).update(body).digest('base64url');
  return `${SESSION_COOKIE}=${body}.${signature}`;
}

let cookieAtual = '';

export function signIn(userId) {
  cookieAtual = sessionCookie(userId);
  return cookieAtual;
}

export function handoffToken(userId) {
  const corpo = Buffer.from(
    JSON.stringify({
      userId,
      audience: 'n8n',
      expiresAt: Date.now() + 50_000,
      jti: randomUUID(),
    }),
  ).toString('base64url');
  const assinatura = createHmac('sha256', env().TRIA_SESSION_SECRET).update(corpo).digest('base64url');
  return `${corpo}.${assinatura}`;
}

export function signOut() {
  cookieAtual = '';
}

function authHeaders(extra = {}) {
  return cookieAtual ? { ...extra, Cookie: cookieAtual } : extra;
}

function actionId(html) {
  const match = html.match(/name="\$ACTION_ID_([a-f0-9]+)"/);
  if (!match) throw new Error('A página não renderizou nenhuma server action.');
  return match[1];
}

export async function submitForm(path, fields) {
  const html = await fetch(`${BASE}${path}`, { headers: authHeaders() }).then((response) => response.text());
  const id = actionId(html);

  const body = new FormData();
  body.set(`$ACTION_ID_${id}`, '');
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((item) => body.append(key, item));
    else body.set(key, value);
  }

  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: authHeaders({ Origin: BASE, Referer: `${BASE}${path}` }),
    body,
    redirect: 'manual',
  });

  const text = await response.text();
  return {
    status: response.status,
    location: response.headers.get('location'),
    redirectedTo: text.match(/"(\/[a-z0-9/-]*(?:[a-f0-9-]{36})?)"/)?.[1] ?? null,
    text,
  };
}

export const post = (path, body) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: workerHeaders(), body: JSON.stringify(body) });

export const get = (path) => fetch(`${BASE}${path}`, { headers: workerHeaders() });

export const browse = (path) => fetch(`${BASE}${path}`, { headers: authHeaders(), redirect: 'manual' });
