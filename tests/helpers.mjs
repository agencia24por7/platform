import { createCipheriv, createHash, createHmac, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
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

const TENTATIVAS_DE_SAUDE = 6;

async function respondeSaude() {
  try {
    const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function appIsUp() {
  for (let tentativa = 1; tentativa <= TENTATIVAS_DE_SAUDE; tentativa++) {
    if (await respondeSaude()) return true;
    if (tentativa < TENTATIVAS_DE_SAUDE) await new Promise((resolver) => setTimeout(resolver, 1000));
  }
  return false;
}

const SESSION_COOKIE = 'tria_sessao';

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql],
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
     ON CONFLICT (organization_id, user_id)
     DO UPDATE SET role = 'owner', revoked_at = NULL, revoked_by = NULL`,
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

function actionIds(html) {
  const todos = [...html.matchAll(/name="\$ACTION_ID_([a-f0-9]+)"/g)].map((match) => match[1]);
  if (todos.length === 0) throw new Error('A página não renderizou nenhuma server action.');
  return [...new Set(todos)];
}

function actionId(html) {
  return actionIds(html)[0];
}

export async function acoesDe(path) {
  const html = await fetch(`${BASE}${path}`, { headers: authHeaders() }).then((response) => response.text());
  return actionIds(html);
}

export async function acaoComCampo(path, campo) {
  const html = await fetch(`${BASE}${path}`, { headers: authHeaders() }).then((response) => response.text());

  for (const pedaco of html.split('<form').slice(1)) {
    const formulario = pedaco.slice(0, pedaco.indexOf('</form>'));
    if (!formulario.includes(`name="${campo}"`)) continue;

    const id = formulario.match(/name="\$ACTION_ID_([a-f0-9]+)"/)?.[1];
    if (id) return id;
  }

  throw new Error(`Nenhuma server action com o campo "${campo}" em ${path}.`);
}

export async function submitAction(path, actionIdEscolhido, fields) {
  const body = new FormData();
  body.set(`$ACTION_ID_${actionIdEscolhido}`, '');
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
    redirectedTo: text.match(/"(\/[a-z0-9/?=%.-]*)"/)?.[1] ?? null,
    text,
  };
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

function selar(chave, texto, aad) {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  cifra.setAAD(aad);
  const corpo = Buffer.concat([cifra.update(texto), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), corpo]);
}

export function envelopeLocal(texto, connectionId, platform, finalidade = 'segredo') {
  const chaveMestra = Buffer.from(hkdfSync('sha256', env().TRIA_SESSION_SECRET, 'orla.tokens.local', 'chave-mestra-local:v1', 32));
  const aad = Buffer.from(`orla.tokens.v1|${connectionId}|${platform}|${finalidade}`);
  const chaveDeDados = randomBytes(32);
  const selado = selar(chaveDeDados, Buffer.from(texto), aad);
  const embrulhada = selar(chaveMestra, chaveDeDados, aad);
  const tamanho = Buffer.alloc(2);
  tamanho.writeUInt16BE(embrulhada.length);
  return Buffer.concat([Buffer.from([1]), tamanho, embrulhada, selado]).toString('hex');
}

export const acessoDeTeste = (segredo) => `teste-acesso-${createHash('sha256').update(segredo).digest('hex').slice(0, 24)}`;

const TIPO_DO_SEGREDO = (platform, grantType) => {
  if (grantType === 'api_key') return 'api_key';
  return ['meta', 'pixel', 'leadads', 'whatsapp'].includes(platform) ? 'oauth_long_lived' : 'oauth_refresh';
};

const literal = (valor) => (valor === null || valor === undefined ? 'NULL' : `'${String(valor).replaceAll("'", "''")}'`);

export function sqlDeConexao({
  id = randomUUID(),
  organizationId,
  platform,
  grantType = 'oauth_user',
  label,
  externalId,
  scopes = [],
  accountEmail = null,
  status = 'active',
  comToken = status !== 'revoked' && status !== 'reauth_pending',
  segredo = `orla-teste:${randomUUID()}`,
}) {
  const escopos = `array[${scopes.map(literal).join(', ')}]::text[]`;
  const conexao = `INSERT INTO integrations.connections
      (id, organization_id, platform, grant_type, label, external_id, scopes, account_email, status)
    VALUES ('${id}', '${organizationId}', '${platform}', '${grantType}', ${literal(label)}, ${literal(externalId)},
            ${escopos}, ${literal(accountEmail)}, '${status}')`;
  if (!comToken) return { id, segredo: null, sql: `${conexao} RETURNING id` };

  const tipo = TIPO_DO_SEGREDO(platform, grantType);
  const expira = tipo === 'oauth_long_lived' ? "now() + interval '50 days'" : 'NULL';
  const sql = `WITH c AS (${conexao} RETURNING id, organization_id)
    INSERT INTO integrations.connection_tokens (connection_id, organization_id, tipo, ciphertext, kms_key_version, algoritmo, segredo_expira_em)
    SELECT id, organization_id, '${tipo}', decode('${envelopeLocal(segredo, id, platform)}', 'hex'), 'local:v1', 'aes-256-gcm+local', ${expira}
    FROM c RETURNING connection_id`;
  return { id, segredo, sql };
}
