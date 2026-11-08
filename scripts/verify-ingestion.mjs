import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

const base = 'http://localhost:3000';
const headers = { Authorization: `Bearer ${env.TRIA_WORKER_TOKEN}`, 'Content-Type': 'application/json' };
const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

const adAccountId = process.env.ACCOUNT_ID;
if (!adAccountId) throw new Error('defina ACCOUNT_ID');
const window = { start: '2026-11-01', end: '2026-11-03' };
const key = 'verificacao-idempotencia-001';

const first = await post('/api/v0/sync/runs', {
  adAccountId, workflow: 'verificacao', triggerSource: 'manual',
  idempotencyKey: key, window, apiVersion: 'graph-v21.0', n8nExecutionId: null,
});
const firstRun = await first.json();
if (!firstRun.id) throw new Error(`abertura falhou: ${first.status} ${JSON.stringify(firstRun)}`);

const second = await post('/api/v0/sync/runs', {
  adAccountId, workflow: 'verificacao', triggerSource: 'manual',
  idempotencyKey: key, window, apiVersion: 'graph-v21.0', n8nExecutionId: null,
});
const secondRun = await second.json();

console.log('idempotência: mesma chave devolve a mesma execução?', firstRun.id === secondRun.id ? 'SIM' : 'NÃO');

const row = (spend) => ({
  externalCampaignId: 'teste-restatement', campaignName: 'Teste', metricDate: '2026-11-02',
  spend, impressions: 1000, clicks: 20, conversions: 2, revenue: 400, currency: 'BRL',
});

const ingestA = await post('/api/v0/sync/metrics', { runId: firstRun.id, rows: [row(100)] }).then((r) => r.json());
const ingestB = await post('/api/v0/sync/metrics', { runId: firstRun.id, rows: [row(140)] }).then((r) => r.json());

console.log('primeira gravação:', JSON.stringify(ingestA));
console.log('regravação com valor diferente:', JSON.stringify(ingestB), ingestB.restated > 0 ? '→ reafirmação detectada' : '→ reafirmação NÃO detectada');

const outOfWindow = await post('/api/v0/sync/metrics', {
  runId: firstRun.id,
  rows: [{ ...row(50), metricDate: '2025-01-01' }],
}).then((r) => r.json());
console.log('linha fora da janela:', JSON.stringify(outOfWindow), outOfWindow.rejected === 1 ? '→ rejeitada' : '→ aceita indevidamente');

const incoherent = await post('/api/v0/sync/metrics', {
  runId: firstRun.id,
  rows: [{ ...row(50), clicks: 99999 }],
}).then((r) => r.json());
console.log('linha incoerente (cliques > impressões):', JSON.stringify(incoherent), incoherent.rejected === 1 ? '→ rejeitada' : '→ aceita indevidamente');

const close = await post('/api/v0/sync/runs/close', {
  runId: firstRun.id, status: 'success', requestCount: 3, apiVersion: 'graph-v21.0',
  errorCode: null, errorMessage: null,
}).then((r) => r.json());
console.log('encerramento:', close.status, `${close.durationMs} ms`);

const reclose = await post('/api/v0/sync/runs/close', {
  runId: firstRun.id, status: 'failed', requestCount: 0, apiVersion: null, errorCode: null, errorMessage: null,
});
console.log('reencerrar execução já fechada:', reclose.status === 409 ? 'bloqueado (409)' : `permitido (${reclose.status})`);
