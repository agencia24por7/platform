#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const AJUDA = `Reconstrói o company brain (ADR 0026), regravando os arquivos mesmo sem mudança.

Uso:
  node scripts/contexto-reconstruir-brain.mjs --org <uuid> --cliente <uuid>
  node scripts/contexto-reconstruir-brain.mjs --org <uuid>
  node scripts/contexto-reconstruir-brain.mjs --todos

Opções: --local (app em localhost:3000, token em WORKER_TOKEN) em vez da produção
(token lido do Secret Manager, app em APP_URL).`;

const PROJETO = process.env.PROJETO ?? 'tria-platform';
const APP_URL = process.env.APP_URL ?? 'https://platform.agencia24por7.com';
const SEGREDO_DO_WORKER = process.env.SEGREDO_DO_WORKER ?? 'tria-producao-worker-token';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const args = process.argv.slice(2);
const valorDe = (nome) => {
  const indice = args.indexOf(nome);
  return indice >= 0 ? args[indice + 1] : undefined;
};

function falhar(mensagem) {
  console.error(mensagem);
  process.exit(1);
}

if (args.includes('--help') || args.length === 0) {
  console.log(AJUDA);
  process.exit(0);
}

const local = args.includes('--local');
const todos = args.includes('--todos');
const org = valorDe('--org');
const cliente = valorDe('--cliente');

if (todos && (org || cliente)) falhar('Use --todos sozinho, ou --org (com --cliente opcional).');
if (!todos && !org) falhar(AJUDA);
for (const [nome, valor] of [['--org', org], ['--cliente', cliente]]) {
  if (valor !== undefined && !UUID.test(valor)) falhar(`${nome} precisa ser um uuid em minúsculas.`);
}

function tokenDoWorker() {
  if (local) return process.env.WORKER_TOKEN ?? process.env.TRIA_WORKER_TOKEN ?? '';
  return execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', '--secret', SEGREDO_DO_WORKER, '--project', PROJETO], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const token = tokenDoWorker();
if (!token) falhar(local ? 'WORKER_TOKEN ausente no ambiente.' : `Segredo ${SEGREDO_DO_WORKER} vazio.`);

const corpo = todos ? { todos: true } : { organizationId: org, ...(cliente ? { clientId: cliente } : {}) };
const base = local ? 'http://localhost:3000' : APP_URL;

const resposta = await fetch(`${base}/api/v0/contexto/reconstruir`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(corpo),
  signal: AbortSignal.timeout(600_000),
});
const texto = await resposta.text();
if (!resposta.ok) falhar(`HTTP ${resposta.status}: ${texto.slice(0, 500)}`);

console.log(`Brain reconstruído: ${texto.slice(0, 500)}`);
