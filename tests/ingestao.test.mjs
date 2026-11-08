import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, describe, it } from 'node:test';
import { appIsUp, browse, ensureUser, get, post, signIn, submitForm } from './helpers.mjs';

const query = (sql) =>
  execFileSync('docker', ['exec', 'tria-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-tAc', sql])
    .toString()
    .trim();

const WINDOW = { start: '2026-11-01', end: '2026-11-05' };

const row = (overrides = {}) => ({
  externalCampaignId: 'campanha-teste',
  campaignName: 'Campanha de teste',
  metricDate: '2026-11-02',
  spend: 100,
  impressions: 1000,
  clicks: 20,
  conversions: 2,
  revenue: 400,
  currency: 'BRL',
  ...overrides,
});

async function ensureAccount() {
  const existing = query('select id from integrations.ad_accounts limit 1');
  if (existing) return existing;

  if (query('select count(*) from core.organizations') === '0') {
    await submitForm('/organizacoes/nova?tipo=agency', {
      type: 'agency',
      name: 'Operação de Ingestão',
      managerAccountId: '812-445-9031',
      businessManagerId: '1094887233',
    });
  }

  const client = await submitForm('/clientes/novo', {
    name: `Cliente de Ingestão ${Date.now()}`,
    segment: '',
    businessModel: 'leads',
    parentClientId: '',
  });
  const clientId = (client.location ?? '').split('/').pop() ?? '';

  await submitForm(`/clientes/${clientId}/contas/nova`, {
    clientId,
    platform: 'meta',
    connectionId: 'new',
    connectionLabel: 'BM de ingestão',
    grantType: 'system_user',
    connectionExternalId: `10948872${Math.floor(Math.random() * 90 + 10)}`,
    credentialRef: 'n8n:credential:meta',
    scopes: ['ads_read'],
    externalId: String(Date.now()).slice(-10),
    name: 'Meta — Ingestão',
    accountGroup: 'Principal',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    syncEnabled: 'on',
  });

  return query('select id from integrations.ad_accounts order by created_at desc limit 1');
}

describe('coleta com metadados e auditoria', { concurrency: false }, () => {
  let accountId = '';
  let runId = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    signIn(ensureUser());
    accountId = await ensureAccount();
    assert.match(accountId, /^[a-f0-9-]{36}$/);
  });

  it('abre execução registrando janela e versão da API', async () => {
    const response = await post('/api/v0/sync/runs', {
      adAccountId: accountId,
      workflow: 'teste',
      triggerSource: 'manual',
      idempotencyKey: `teste-${Date.now()}`,
      window: WINDOW,
      apiVersion: 'graph-v21.0',
      n8nExecutionId: '42',
    });
    assert.equal(response.status, 201);

    const run = await response.json();
    runId = run.id;
    assert.equal(run.status, 'running');
    assert.deepEqual(run.window, WINDOW);
    assert.equal(query(`select api_version from automation.sync_runs where id = '${runId}'`), 'graph-v21.0');
    assert.equal(query(`select n8n_execution_id from automation.sync_runs where id = '${runId}'`), '42');
  });

  it('a mesma chave de idempotência não abre execução nova', async () => {
    const key = `idempotencia-${Date.now()}`;
    const payload = {
      adAccountId: accountId,
      workflow: 'teste',
      triggerSource: 'manual',
      idempotencyKey: key,
      window: WINDOW,
      apiVersion: null,
      n8nExecutionId: null,
    };

    const first = await post('/api/v0/sync/runs', payload).then((r) => r.json());
    const second = await post('/api/v0/sync/runs', payload).then((r) => r.json());

    assert.equal(first.id, second.id);
    assert.equal(query(`select count(*) from automation.sync_runs where idempotency_key = '${key}'`), '1');
  });

  it('recusa janela maior que o limite', async () => {
    const response = await post('/api/v0/sync/runs', {
      adAccountId: accountId,
      workflow: 'teste',
      triggerSource: 'manual',
      idempotencyKey: `janela-${Date.now()}`,
      window: { start: '2020-01-01', end: '2026-01-01' },
      apiVersion: null,
      n8nExecutionId: null,
    });
    assert.equal(response.status, 422);
  });

  it('recusa conta inexistente', async () => {
    const response = await post('/api/v0/sync/runs', {
      adAccountId: '00000000-0000-4000-8000-000000000000',
      workflow: 'teste',
      triggerSource: 'manual',
      idempotencyKey: `fantasma-${Date.now()}`,
      window: WINDOW,
      apiVersion: null,
      n8nExecutionId: null,
    });
    assert.equal(response.status, 404);
  });

  it('grava métricas', async () => {
    const result = await post('/api/v0/sync/metrics', { runId, rows: [row()] }).then((r) => r.json());
    assert.deepEqual(result, { received: 1, written: 1, restated: 0, rejected: 0 });
  });

  it('regravar o mesmo dia não duplica linha', async () => {
    await post('/api/v0/sync/metrics', { runId, rows: [row()] });
    assert.equal(
      query(`select count(*) from metrics.metrics_daily where ad_account_id = '${accountId}'`),
      '1',
    );
  });

  it('valor diferente vira reafirmação registrada', async () => {
    const result = await post('/api/v0/sync/metrics', { runId, rows: [row({ spend: 140 })] }).then((r) =>
      r.json(),
    );
    assert.equal(result.restated, 1);

    const restatement = query(
      `select field || ':' || previous_value || '->' || new_value from metrics.metrics_restatements order by id desc limit 1`,
    );
    assert.equal(restatement, 'spend:100.00->140.00');
  });

  it('rejeita linha fora da janela declarada', async () => {
    const result = await post('/api/v0/sync/metrics', {
      runId,
      rows: [row({ metricDate: '2020-01-01' })],
    }).then((r) => r.json());
    assert.equal(result.rejected, 1);
    assert.equal(result.written, 0);
  });

  it('rejeita linha incoerente', async () => {
    const result = await post('/api/v0/sync/metrics', {
      runId,
      rows: [row({ clicks: 999_999 })],
    }).then((r) => r.json());
    assert.equal(result.rejected, 1);
  });

  it('recusa valor negativo no schema', async () => {
    const response = await post('/api/v0/sync/metrics', { runId, rows: [row({ spend: -1 })] });
    assert.equal(response.status, 422);
  });

  it('recusa lote acima do limite', async () => {
    const response = await post('/api/v0/sync/metrics', {
      runId,
      rows: Array.from({ length: 5001 }, () => row()),
    });
    assert.equal(response.status, 422);
  });

  it('encerra a execução com duração e contagem', async () => {
    const result = await post('/api/v0/sync/runs/close', {
      runId,
      status: 'success',
      requestCount: 7,
      apiVersion: 'graph-v21.0',
      errorCode: null,
      errorMessage: null,
    }).then((r) => r.json());

    assert.equal(result.status, 'success');
    assert.ok(result.durationMs >= 0);
    assert.equal(result.requestCount, 7);
    assert.ok(result.rowsReceived >= 5);
  });

  it('não permite encerrar duas vezes', async () => {
    const response = await post('/api/v0/sync/runs/close', {
      runId,
      status: 'failed',
      requestCount: 0,
      apiVersion: null,
      errorCode: null,
      errorMessage: null,
    });
    assert.equal(response.status, 409);
  });

  it('não aceita métrica em execução encerrada', async () => {
    const response = await post('/api/v0/sync/metrics', { runId, rows: [row()] });
    assert.equal(response.status, 409);
  });

  it('marca a conta como sincronizada e tira da fila pelo intervalo mínimo', async () => {
    assert.notEqual(query(`select last_sync_at from integrations.ad_accounts where id = '${accountId}'`), '');
    const queue = await get('/api/v0/sync/queue').then((r) => r.json());
    assert.ok(
      !queue.accounts.some((entry) => entry.adAccountId === accountId),
      'conta recém-sincronizada não deve voltar na fila',
    );
  });

  it('registra toda a trilha do worker', async () => {
    const actions = query(
      "select string_agg(distinct action, ',' order by action) from audit.audit_log where actor_type = 'worker'",
    );
    assert.equal(actions, 'sync.metrics.ingest,sync.queue.read,sync.run.close,sync.run.open');
  });
});
