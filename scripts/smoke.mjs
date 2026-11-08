import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const base = 'http://localhost:3000';
const authorized = { Authorization: `Bearer ${env.TRIA_WORKER_TOKEN}`, 'Content-Type': 'application/json' };

const results = [];
const check = (label, passed, detail = '') => results.push({ label, passed, detail });

const noToken = await fetch(`${base}/api/v0/sync/queue`);
check('fila sem token devolve 401', noToken.status === 401, String(noToken.status));

const wrongToken = await fetch(`${base}/api/v0/sync/queue`, { headers: { Authorization: 'Bearer errado' } });
check('fila com token errado devolve 401', wrongToken.status === 401, String(wrongToken.status));

const good = await fetch(`${base}/api/v0/sync/queue`, { headers: authorized });
const queue = await good.json();
check('fila com token correto devolve 200', good.status === 200, `${good.status} · ${queue.count} contas`);

const badPayload = await fetch(`${base}/api/v0/sync/runs`, {
  method: 'POST',
  headers: authorized,
  body: JSON.stringify({ adAccountId: 'nao-e-uuid' }),
});
check('payload inválido devolve 422 problem+json', badPayload.status === 422,
  `${badPayload.status} · ${badPayload.headers.get('content-type')}`);

const headers = await fetch(`${base}/clientes`);
const required = ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy'];
const missing = required.filter((header) => !headers.headers.get(header));
check('cabeçalhos de segurança presentes', missing.length === 0, missing.join(', ') || 'todos');
check('sem x-powered-by', headers.headers.get('x-powered-by') === null);

for (const result of results) {
  console.log(`${result.passed ? 'OK  ' : 'FALHA'} ${result.label}${result.detail ? ` — ${result.detail}` : ''}`);
}
process.exit(results.every((result) => result.passed) ? 0 : 1);
