import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, describe, it } from 'node:test';
import { appIsUp, ensureUser, get, makeOwner, post, signIn, submitForm } from './helpers.mjs';

const query = (sql) =>
  execFileSync('docker', ['exec', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql])
    .toString()
    .trim()
    .split('\n')[0]
    .trim();

const WINDOW = { start: '2026-11-01', end: '2026-11-07' };

async function ensureAccount(userId) {
  let organizationId = query('select id from core.organizations order by created_at limit 1');
  if (!organizationId) {
    await submitForm('/organizacoes/nova?tipo=agency', {
      type: 'agency',
      name: 'Operação de Coleta',
      managerAccountId: '812-445-9032',
      businessManagerId: '1094887234',
    });
    organizationId = query('select id from core.organizations order by created_at limit 1');
  }

  makeOwner(userId, organizationId);

  const clientId = query(
    `insert into core.clients (organization_id, name, business_model)
     values ('${organizationId}', 'Cliente de Coleta ${Date.now()}', 'leads') returning id`,
  );

  const connectionId = query(
    `insert into integrations.connections
       (organization_id, platform, grant_type, label, external_id, scopes, credential_ref)
     values ('${organizationId}', 'google', 'mcc', 'MCC de coleta',
             '10948872${Math.floor(Math.random() * 90 + 10)}',
             array['https://www.googleapis.com/auth/adwords'], 'n8n:credential:google')
     returning id`,
  );

  const accountId = query(
    `insert into integrations.ad_accounts
       (organization_id, client_id, connection_id, platform, external_id, name, account_group)
     values ('${organizationId}', '${clientId}', '${connectionId}', 'google',
             '${Math.floor(Math.random() * 9_000_000_000 + 1_000_000_000)}', 'Google Ads — Coleta', 'Principal')
     returning id`,
  );

  return { accountId, connectionId, clientId, organizationId };
}

describe('camada de coleta', { concurrency: false }, () => {
  let accountId = '';
  let connectionId = '';
  let coletaId = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    const usuario = ensureUser('coleta@tria.local');
    signIn(usuario);
    const conta = await ensureAccount(usuario);
    accountId = conta.accountId;
    connectionId = conta.connectionId;
    assert.match(accountId, /^[a-f0-9-]{36}$/);
  });

  it('lista a fonte recém-criada entre as elegíveis', async () => {
    const result = await get('/api/v0/coleta/fontes?limit=200').then((r) => r.json());
    assert.ok(result.fontes.some((fonte) => fonte.fonteId === accountId && fonte.fonteTipo === 'ad_account'));
  });

  it('a janela sugerida muda com o modo e sempre termina ontem', async () => {
    const amostra = await get('/api/v0/coleta/fontes?limit=200&modo=amostra').then((r) => r.json());
    const completa = await get('/api/v0/coleta/fontes?limit=200&modo=completa').then((r) => r.json());

    const fonteAmostra = amostra.fontes.find((fonte) => fonte.fonteId === accountId);
    const fonteCompleta = completa.fontes.find((fonte) => fonte.fonteId === accountId);
    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    assert.equal(fonteAmostra.janelaSugerida.end, ontem);
    assert.equal(fonteCompleta.janelaSugerida.end, ontem);
    assert.notEqual(fonteAmostra.janelaSugerida.start, fonteCompleta.janelaSugerida.start, 'amostra (7d) e completa (28d) devem ter início diferente');
  });

  it('abre execução em modo amostra', async () => {
    const response = await post('/api/v0/coleta/abrir', {
      fonteTipo: 'ad_account',
      fonteId: accountId,
      mode: 'amostra',
      window: WINDOW,
      idempotencyKey: `coleta-teste-${Date.now()}`,
      n8nExecutionId: '7',
    });
    assert.equal(response.status, 201);

    const coleta = await response.json();
    coletaId = coleta.id;
    assert.equal(coleta.status, 'running');
    assert.equal(coleta.platform, 'google');
    assert.equal(coleta.mode, 'amostra');
    assert.deepEqual(coleta.window, WINDOW);
  });

  it('a mesma chave de idempotência não abre execução nova', async () => {
    const key = `coleta-idempotencia-${Date.now()}`;
    const payload = {
      fonteTipo: 'ad_account',
      fonteId: accountId,
      mode: 'amostra',
      window: WINDOW,
      idempotencyKey: key,
      n8nExecutionId: null,
    };

    const first = await post('/api/v0/coleta/abrir', payload).then((r) => r.json());
    const second = await post('/api/v0/coleta/abrir', payload).then((r) => r.json());

    assert.equal(first.id, second.id);
    assert.equal(query(`select count(*) from automation.coletas where idempotency_key = '${key}'`), '1');
  });

  it('recusa janela maior que o limite da plataforma', async () => {
    const response = await post('/api/v0/coleta/abrir', {
      fonteTipo: 'ad_account',
      fonteId: accountId,
      mode: 'amostra',
      window: { start: '2020-01-01', end: '2026-01-01' },
      idempotencyKey: `coleta-janela-${Date.now()}`,
      n8nExecutionId: null,
    });
    assert.equal(response.status, 422);
  });

  it('recusa fonte inexistente', async () => {
    const response = await post('/api/v0/coleta/abrir', {
      fonteTipo: 'ad_account',
      fonteId: '00000000-0000-4000-8000-000000000000',
      mode: 'amostra',
      window: WINDOW,
      idempotencyKey: `coleta-fantasma-${Date.now()}`,
      n8nExecutionId: null,
    });
    assert.equal(response.status, 404);
  });

  it('encerra a execução com qualidade e volumetria', async () => {
    const qualidadeResumo = {
      fontesEsperadas: 1,
      fontesColetadas: 1,
      faltantes: [],
      paridade: [],
      volumetria: { linhas: 42, bytes: 2048, requests: 1, duracaoMs: 350 },
    };

    const result = await post('/api/v0/coleta/fechar', {
      coletaId,
      status: 'success',
      requestCount: 1,
      rowsReceived: 42,
      rowsWritten: 42,
      qualidadeResumo,
      errorCode: null,
      errorMessage: null,
    }).then((r) => r.json());

    assert.equal(result.status, 'success');
    assert.ok(result.durationMs >= 0);
    assert.equal(result.rowsWritten, 42);
    assert.deepEqual(result.qualidadeResumo, qualidadeResumo);
  });

  it('gravar recusa coleta inexistente', async () => {
    const response = await post('/api/v0/coleta/gravar', {
      coletaId: '00000000-0000-4000-8000-000000000000',
      linhas: [{ externalCampaignId: 'c1', metricDate: '2026-11-01', spend: 10 }],
    });
    assert.equal(response.status, 404);
  });

  it('gravar recusa quando o BigQuery não está configurado neste ambiente', async () => {
    const response = await post('/api/v0/coleta/gravar', {
      coletaId,
      linhas: [{ externalCampaignId: 'c1', metricDate: '2026-11-01', spend: 10 }],
    });
    assert.equal(response.status, 503);
  });

  it('não permite encerrar duas vezes', async () => {
    const response = await post('/api/v0/coleta/fechar', {
      coletaId,
      status: 'failed',
      requestCount: 0,
      rowsReceived: 0,
      rowsWritten: 0,
      qualidadeResumo: null,
      errorCode: null,
      errorMessage: null,
    });
    assert.equal(response.status, 409);
  });

  it('erro de reautorização marca a conexão como reauth_pending', async () => {
    const payload = {
      fonteTipo: 'ad_account',
      fonteId: accountId,
      mode: 'amostra',
      window: WINDOW,
      idempotencyKey: `coleta-reauth-${Date.now()}`,
      n8nExecutionId: null,
    };
    const aberta = await post('/api/v0/coleta/abrir', payload).then((r) => r.json());

    await post('/api/v0/coleta/fechar', {
      coletaId: aberta.id,
      status: 'failed',
      requestCount: 1,
      rowsReceived: 0,
      rowsWritten: 0,
      qualidadeResumo: null,
      errorCode: 'reauth_pending',
      errorMessage: 'token expirado',
    });

    assert.equal(query(`select status from integrations.connections where id = '${connectionId}'`), 'reauth_pending');
  });

  it('registra toda a trilha do worker', async () => {
    const actions = query(
      "select string_agg(distinct action, ',' order by action) from audit.audit_log where actor_type = 'worker' and action like 'coleta.%'",
    );
    assert.equal(actions, 'coleta.execucao.abrir,coleta.execucao.fechar,coleta.fontes.lidas');
  });
});
