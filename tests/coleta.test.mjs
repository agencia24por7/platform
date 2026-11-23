import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, ensureUser, get, makeOwner, post, signIn, sqlDeConexao, submitForm, workerHeaders } from './helpers.mjs';
import { PG_CONTAINER } from './apoio/pgContainer.mjs';

const query = (sql) =>
  execFileSync('docker', ['exec', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql])
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
    sqlDeConexao({
      organizationId,
      platform: 'google',
      grantType: 'mcc',
      label: 'MCC de coleta',
      externalId: `109${Date.now()}${Math.floor(Math.random() * 900 + 100)}`,
      scopes: ['https://www.googleapis.com/auth/adwords'],
    }).sql,
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
  let clientId = '';
  let coletaId = '';
  let contaLivre = { accountId: '', organizationId: '', clientId: '' };

  const liberar = (conta) => query(
    `update automation.coletas set status = 'failed', finished_at = now() where ad_account_id = '${conta}' and status = 'running'`,
  );
  const ontemEmSaoPaulo = () => {
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return new Date(Date.parse(`${hoje}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  };

  const abrirNova = (prefixo) =>
    post('/api/v0/coleta/abrir', {
      fonteTipo: 'ad_account',
      fonteId: accountId,
      mode: 'amostra',
      window: WINDOW,
      idempotencyKey: `${prefixo}-${Date.now()}`,
      n8nExecutionId: null,
    }).then((r) => r.json());

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    const usuario = ensureUser('coleta@tria.local');
    signIn(usuario);
    const conta = await ensureAccount(usuario);
    accountId = conta.accountId;
    connectionId = conta.connectionId;
    clientId = conta.clientId;
    contaLivre = await ensureAccount(usuario);
    assert.match(accountId, /^[a-f0-9-]{36}$/);
  });

  it('lista a fonte recém-criada entre as elegíveis', async () => {
    const result = await get('/api/v0/coleta/fontes?limit=200').then((r) => r.json());
    const fonte = result.fontes.find((item) => item.fonteId === accountId && item.fonteTipo === 'ad_account');
    assert.ok(fonte);
    assert.equal(fonte.temToken, true, 'a fonte diz se a conexão tem token no cofre');
    for (const campo of ['coletorRef', 'credentialRef', 'executorRef']) assert.equal(campo in fonte, false, campo);
  });

  it('conexão sem token no cofre não é elegível: só volta depois de reautorizar', async () => {
    query(`update integrations.connections set status = 'reauth_pending' where id = '${connectionId}'`);
    const sem = await get('/api/v0/coleta/fontes?limit=200').then((r) => r.json());
    assert.ok(!sem.fontes.some((item) => item.fonteId === accountId));
    query(`update integrations.connections set status = 'active' where id = '${connectionId}'`);
  });

  it('a janela sugerida muda com o modo e sempre termina ontem', async () => {
    const amostra = await get('/api/v0/coleta/fontes?limit=200&modo=amostra').then((r) => r.json());
    const completa = await get('/api/v0/coleta/fontes?limit=200&modo=completa').then((r) => r.json());

    const fonteAmostra = amostra.fontes.find((fonte) => fonte.fonteId === accountId);
    const fonteCompleta = completa.fontes.find((fonte) => fonte.fonteId === accountId);
    const ontem = ontemEmSaoPaulo();

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
      fonteId: contaLivre.accountId,
      mode: 'amostra',
      window: WINDOW,
      idempotencyKey: key,
      n8nExecutionId: null,
    };

    const first = await post('/api/v0/coleta/abrir', payload).then((r) => r.json());
    const second = await post('/api/v0/coleta/abrir', payload).then((r) => r.json());

    assert.equal(first.id, second.id);
    assert.equal(query(`select count(*) from automation.coletas where idempotency_key = '${key}'`), '1');
    liberar(contaLivre.accountId);
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
      avisos: [],
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

  it('gravar recusa coleta já fechada, antes de tocar no BigQuery', async () => {
    const response = await post('/api/v0/coleta/gravar', {
      coletaId,
      linhas: [{ externalCampaignId: 'c1', metricDate: '2026-11-01', spend: 10 }],
    });
    assert.equal(response.status, 409);
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

  it('gravar em coleta running de cliente ativo passa pelo contexto e chega ao BigQuery (503 sem BigQuery aqui)', async () => {
    const aberta = await abrirNova('coleta-grava');
    assert.match(aberta.id ?? '', /^[a-f0-9-]{36}$/, `abrir falhou: ${JSON.stringify(aberta)}`);
    const response = await post('/api/v0/coleta/gravar', {
      coletaId: aberta.id,
      linhas: [{ externalCampaignId: 'c1', metricDate: '2026-11-01', spend: 10 }],
    });
    assert.equal(response.status, 503);
    const corpo = await response.json();
    assert.match(corpo.title, /bigquery_indisponivel/);
  });

  it('reabrir a mesma chave depois de fechada abre outra execução; em running devolve a mesma', async () => {
    liberar(accountId);
    const key = `coleta-reabre-${Date.now()}`;
    const payload = { fonteTipo: 'ad_account', fonteId: accountId, mode: 'amostra', window: WINDOW, idempotencyKey: key, n8nExecutionId: null };
    const primeira = await post('/api/v0/coleta/abrir', payload).then((r) => r.json());
    await post('/api/v0/coleta/fechar', {
      coletaId: primeira.id, status: 'failed', requestCount: 0, rowsReceived: 0, rowsWritten: 0,
      qualidadeResumo: null, errorCode: null, errorMessage: null,
    });
    const segunda = await post('/api/v0/coleta/abrir', payload).then((r) => r.json());
    const repetida = await post('/api/v0/coleta/abrir', payload).then((r) => r.json());
    assert.notEqual(segunda.id, primeira.id);
    assert.equal(segunda.status, 'running');
    assert.equal(repetida.id, segunda.id);
    assert.equal(query(`select idempotency_key from automation.coletas where id = '${segunda.id}'`), `${key}#2`);
  });

  it('rota de worker recusa com 413 corpo acima do limite', async () => {
    const response = await fetch(`${BASE}/api/v0/coleta/abrir`, {
      method: 'POST',
      headers: workerHeaders(),
      body: JSON.stringify({ lixo: 'x'.repeat(1_100_000) }),
    });
    assert.equal(response.status, 413);
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
    liberar(accountId);
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

  it('gravar recusa com 404 cliente excluído, mesmo com a coleta aberta', async () => {
    query(`update integrations.connections set status = 'active' where id = '${connectionId}'`);
    liberar(accountId);
    const aberta = await abrirNova('coleta-excluido');
    assert.match(aberta.id ?? '', /^[a-f0-9-]{36}$/, `abrir falhou: ${JSON.stringify(aberta)}`);
    query(`select core.excluir_cliente('${clientId}', 'teste')`);
    const response = await post('/api/v0/coleta/gravar', {
      coletaId: aberta.id,
      linhas: [{ externalCampaignId: 'c1', metricDate: '2026-11-01', spend: 10 }],
    });
    assert.equal(response.status, 404);
  });

  it('abrir recusa a segunda coleta running da mesma fonte com 409 fonte_ocupada', async () => {
    liberar(contaLivre.accountId);
    const abrir = (chave) => post('/api/v0/coleta/abrir', {
      fonteTipo: 'ad_account', fonteId: contaLivre.accountId, mode: 'incremental', window: WINDOW, idempotencyKey: `${chave}-${Date.now()}`, n8nExecutionId: null,
    });
    const primeira = await abrir('ocupada-a');
    assert.equal(primeira.status, 201);
    const segunda = await abrir('ocupada-b');
    assert.equal(segunda.status, 409);
    const corpo = await segunda.json();
    assert.equal(corpo.errors?.motivo, 'fonte_ocupada');
    liberar(contaLivre.accountId);
  });

  it('fontes expira coleta running abandonada há mais de 8 h', async () => {
    const aberta = await post('/api/v0/coleta/abrir', {
      fonteTipo: 'ad_account', fonteId: contaLivre.accountId, mode: 'incremental', window: WINDOW, idempotencyKey: `abandonada-${Date.now()}`, n8nExecutionId: null,
    }).then((r) => r.json());
    query(`update automation.coletas set started_at = now() - interval '9 hours' where id = '${aberta.id}'`);
    await get('/api/v0/coleta/fontes?limit=200&modo=incremental');
    assert.equal(query(`select status || ':' || error_code from automation.coletas where id = '${aberta.id}'`), 'failed:abandonada');
  });

  it('historico_de_coleta ignora amostra e só aceita parcial repetida 3 vezes', async () => {
    const inserir = (modo, status, fim) => query(
      `insert into automation.coletas (organization_id, client_id, platform, fonte_tipo, ad_account_id, mode, idempotency_key, status, window_start, window_end, finished_at)
       values ('${contaLivre.organizationId}', '${contaLivre.clientId}', 'google', 'ad_account', '${contaLivre.accountId}', '${modo}',
               'hist-${modo}-${status}-${fim}-${Math.random()}', '${status}', date '${fim}' - 6, date '${fim}', now())`,
    );
    inserir('amostra', 'success', '2026-11-10');
    inserir('completa', 'success', '2026-10-01');
    for (let vez = 0; vez < 3; vez += 1) inserir('incremental', 'partial', '2026-10-20');
    inserir('incremental', 'partial', '2026-10-25');
    const linha = query(
      `select ultima_janela_sucesso || '|' || ultima_janela_parcial_repetida from automation.historico_de_coleta() where fonte_id = '${contaLivre.accountId}'`,
    );
    assert.equal(linha, '2026-10-01|2026-10-20');
    const fontes = await get('/api/v0/coleta/fontes?limit=200&modo=incremental').then((r) => r.json());
    const livre = fontes.fontes.find((fonte) => fonte.fonteId === contaLivre.accountId);
    assert.equal(livre.marcaDagua, '2026-10-20');
    assert.equal(livre.marcaPorParcial, true);
    assert.equal(livre.janelaSugerida.start, '2026-10-14');
  });

  it('cota diária do Google Ads pausa todas as fontes google até a meia-noite do Pacífico', async () => {
    const aberta = await post('/api/v0/coleta/abrir', {
      fonteTipo: 'ad_account', fonteId: contaLivre.accountId, mode: 'incremental', window: WINDOW, idempotencyKey: `cota-${Date.now()}`, n8nExecutionId: null,
    }).then((r) => r.json());
    const fechada = await post('/api/v0/coleta/fechar', {
      coletaId: aberta.id, status: 'failed', requestCount: 1, rowsReceived: 0, rowsWritten: 0, qualidadeResumo: null,
      errorCode: 'limite_de_uso', errorMessage: 'RESOURCE_EXHAUSTED', pausa: { motivo: 'cota_diaria', minutos: null },
    });
    assert.equal(fechada.status, 200);
    assert.equal(query(`select pausa_motivo || ':' || pausa_escopo || ':' || (pausa_ate > now()) from automation.coletas where id = '${aberta.id}'`), 'cota_diaria:plataforma:true');
    const fontes = await get('/api/v0/coleta/fontes?limit=200&modo=incremental').then((r) => r.json());
    assert.ok(!fontes.fontes.some((fonte) => fonte.platform === 'google' && [accountId, contaLivre.accountId].includes(fonte.fonteId)));
    query(`update automation.coletas set pausa_ate = null where id = '${aberta.id}'`);
  });

  it('registra toda a trilha do worker', async () => {
    const actions = query(
      "select string_agg(distinct action, ',' order by action) from audit.audit_log where actor_type = 'worker' and action like 'coleta.%'",
    );
    assert.equal(actions, 'coleta.execucao.abrir,coleta.execucao.fechar,coleta.fontes.lidas');
  });
});
