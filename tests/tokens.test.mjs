import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { BASE, acessoDeTeste, appIsUp, envelopeLocal, ensureUser, makeOwner, post, signIn, get, sqlDeConexao, submitForm, workerHeaders } from './helpers.mjs';
import { psqlDonoPrimeiraLinha as query } from './apoio/psql.mjs';

const WINDOW = { start: '2026-11-01', end: '2026-11-07' };

function guardarToken(connectionId, organizationId, segredo) {
  query(
    `insert into integrations.connection_tokens (connection_id, organization_id, tipo, ciphertext, kms_key_version, algoritmo)
     values ('${connectionId}', '${organizationId}', 'oauth_refresh', decode('${envelopeLocal(segredo, connectionId, 'google')}', 'hex'),
             'local:v1', 'aes-256-gcm+local')
     on conflict (connection_id) do update set ciphertext = excluded.ciphertext, access_token_ciphertext = null,
       access_kms_key_version = null, access_expires_at = null, versao = integrations.connection_tokens.versao + 1;
     update integrations.connections set status = 'active' where id = '${connectionId}';
     select 1`,
  );
}

async function criarFonte(usuario, segredo = `orla-teste:${randomUUID()}`) {
  let organizationId = query('select id from core.organizations order by created_at limit 1');
  if (!organizationId) {
    await submitForm('/organizacoes/nova?tipo=agency', {
      type: 'agency',
      name: 'Operação de Tokens',
      managerAccountId: '812-445-9032',
      businessManagerId: '1094887234',
    });
    organizationId = query('select id from core.organizations order by created_at limit 1');
  }
  makeOwner(usuario, organizationId);

  const clientId = query(
    `insert into core.clients (organization_id, name, business_model)
     values ('${organizationId}', 'Cliente de Tokens ${randomUUID().slice(0, 8)}', 'leads') returning id`,
  );
  const connectionId = query(
    sqlDeConexao({
      organizationId,
      platform: 'google',
      grantType: 'mcc',
      label: 'MCC do cofre',
      externalId: String(Math.floor(Math.random() * 9e9 + 1e9)),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      segredo,
    }).sql,
  );
  const accountId = query(
    `insert into integrations.ad_accounts (organization_id, client_id, connection_id, platform, external_id, name, account_group)
     values ('${organizationId}', '${clientId}', '${connectionId}', 'google', '${Math.floor(Math.random() * 9e9 + 1e9)}',
             'Google Ads — Cofre', 'Principal') returning id`,
  );
  const coleta = await post('/api/v0/coleta/abrir', {
    fonteTipo: 'ad_account',
    fonteId: accountId,
    mode: 'amostra',
    window: WINDOW,
    idempotencyKey: `tokens-${randomUUID()}`,
    n8nExecutionId: null,
  }).then((r) => r.json());
  assert.match(coleta.id, /^[a-f0-9-]{36}$/);
  return { organizationId, connectionId, accountId, coletaId: coleta.id, segredo };
}

const pedirToken = (corpo) => post('/api/v0/coleta/token', corpo);

describe('cofre de tokens: rota do worker', { concurrency: false }, () => {
  let fonte;
  let segredo = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    const usuario = ensureUser('tokens@tria.local');
    signIn(usuario);
    fonte = await criarFonte(usuario);
    segredo = fonte.segredo;
  });

  it('exige a credencial do worker', async () => {
    const resposta = await fetch(`${BASE}/api/v0/coleta/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coletaId: fonte.coletaId }),
    });
    assert.equal(resposta.status, 401);
    const proativa = await fetch(`${BASE}/api/v0/tokens/renovar-proativo`, { method: 'POST', body: '{}' });
    assert.equal(proativa.status, 401);
    const recifragem = await fetch(`${BASE}/api/v0/tokens/recifrar`, { method: 'POST', body: '{}' });
    assert.equal(recifragem.status, 401);
  });

  it('pelo proxy público a rota não existe: X-Forwarded-For de fora, Forwarded ou https encaminhado viram 404', async () => {
    const cabecalhos = [
      { 'X-Forwarded-For': '203.0.113.9' },
      { 'X-Forwarded-For': '10.0.0.5, 203.0.113.9' },
      { Forwarded: 'for=203.0.113.9' },
      { 'X-Real-IP': '203.0.113.9' },
      { 'X-Forwarded-Proto': 'https' },
    ];
    for (const extra of cabecalhos) {
      for (const rota of ['/api/v0/coleta/token', '/api/v0/tokens/renovar-proativo', '/api/v0/tokens/recifrar']) {
        const resposta = await fetch(`${BASE}${rota}`, {
          method: 'POST',
          headers: { ...workerHeaders(), ...extra },
          body: JSON.stringify({ coletaId: fonte.coletaId }),
        });
        assert.equal(resposta.status, 404, `${rota} ${JSON.stringify(extra)}`);
      }
    }
  });

  it('valida o corpo e não conhece coleta inventada', async () => {
    assert.equal((await pedirToken({ coletaId: 'nao-e-uuid' })).status, 422);
    assert.equal((await pedirToken({ coletaId: fonte.coletaId, tarefaId: randomUUID() })).status, 422);
    assert.equal((await pedirToken({ coletaId: randomUUID() })).status, 404);
  });

  it('conexão pós-corte (token apagado, reauth_pending) é recusada e o coletor genérico cai em reauth_pending', async () => {
    query(
      `delete from integrations.connection_tokens where connection_id = '${fonte.connectionId}';
       update integrations.connections set status = 'reauth_pending' where id = '${fonte.connectionId}';
       select 1`,
    );
    const resposta = await pedirToken({ coletaId: fonte.coletaId });
    assert.equal(resposta.status, 409);
    assert.equal((await resposta.json()).errors.motivo, 'reauth_pending');
  });

  it('o banco não deixa a conexão voltar a active sem token', () => {
    let erro = '';
    try {
      query(`update integrations.connections set status = 'active' where id = '${fonte.connectionId}'`);
    } catch (falha) {
      erro = String(falha.stderr ?? falha.message);
    }
    assert.match(erro, /ativa sem token no cofre/);
  });

  it('reautorizar (novo token + active na mesma transação) devolve o access token, sem cache HTTP e sem token na auditoria', async () => {
    guardarToken(fonte.connectionId, fonte.organizationId, segredo);

    const resposta = await pedirToken({ coletaId: fonte.coletaId });
    assert.equal(resposta.status, 200);
    assert.equal(resposta.headers.get('cache-control'), 'no-store');
    const corpo = await resposta.json();
    assert.equal(corpo.token, acessoDeTeste(segredo));
    assert.equal(corpo.tipo, 'bearer');
    assert.ok(Date.parse(corpo.expiraEm) > Date.now());

    const guardado = query(
      `select encode(access_token_ciphertext, 'hex') from integrations.connection_tokens where connection_id = '${fonte.connectionId}'`,
    );
    assert.ok(guardado.length > 0);
    assert.ok(!Buffer.from(guardado, 'hex').toString('latin1').includes(corpo.token));

    const auditoria = query(
      `select coalesce(string_agg(metadata::text, '|'), '') from audit.audit_log
       where target_id = '${fonte.connectionId}' and action like 'tokens.%'`,
    );
    assert.ok(auditoria.includes(fonte.coletaId));
    assert.ok(!auditoria.includes(corpo.token));
    assert.ok(!auditoria.includes(segredo));
    assert.equal(
      query(`select count(*) from audit.audit_log where target_id = '${fonte.connectionId}' and action = 'tokens.acesso.emitido'`),
      '1',
    );
  });

  it('serve também a tarefa de conta em execução', async () => {
    const tarefaId = query(
      `insert into automation.account_tasks (organization_id, connection_id, kind, manager_external_id, target_external_id, status)
       values ('${fonte.organizationId}', '${fonte.connectionId}', 'mcc_invite', '8124459032', '${Math.floor(Math.random() * 9e9 + 1e9)}', 'running')
       returning id`,
    );
    const resposta = await pedirToken({ tarefaId });
    assert.equal(resposta.status, 200);
    assert.equal((await resposta.json()).token, acessoDeTeste(segredo));
  });

  it('conexão em reauth_pending é recusada', async () => {
    query(`update integrations.connections set status = 'reauth_pending' where id = '${fonte.connectionId}'`);
    const resposta = await pedirToken({ coletaId: fonte.coletaId });
    assert.equal(resposta.status, 409);
    assert.equal((await resposta.json()).errors.motivo, 'reauth_pending');

    const pendente = query(
      `insert into automation.account_tasks (organization_id, connection_id, kind, manager_external_id, target_external_id)
       values ('${fonte.organizationId}', '${fonte.connectionId}', 'mcc_invite', '8124459032', '${Math.floor(Math.random() * 9e9 + 1e9)}')
       returning id`,
    );
    const fila = await get('/api/v0/tasks/queue?limit=50&kinds=mcc_invite').then((r) => r.json());
    assert.ok(!fila.tasks.some((tarefa) => tarefa.taskId === pendente), 'tarefa de conexão a reautorizar não é reivindicada');
    assert.ok(fila.esperandoReautorizacao >= 1);
    assert.equal(query(`select status || '|' || attempts from automation.account_tasks where id = '${pendente}'`), 'pending|0');
    query(`update integrations.connections set status = 'active' where id = '${fonte.connectionId}'`);
  });

  it('coleta running há mais de 6 horas não entrega token', async () => {
    query(`update automation.coletas set started_at = now() - interval '7 hours' where id = '${fonte.coletaId}'`);
    const resposta = await pedirToken({ coletaId: fonte.coletaId });
    assert.equal(resposta.status, 409);
    assert.equal((await resposta.json()).errors.motivo, 'origem_encerrada');
    query(`update automation.coletas set started_at = now() where id = '${fonte.coletaId}'`);
  });

  it('coleta encerrada é recusada', async () => {
    query(`update automation.coletas set status = 'failed', finished_at = now() where id = '${fonte.coletaId}'`);
    const resposta = await pedirToken({ coletaId: fonte.coletaId });
    assert.equal(resposta.status, 409);
    assert.equal((await resposta.json()).errors.motivo, 'origem_encerrada');
  });

  it('invalid_grant do provedor marca a conexão como reauth_pending', async () => {
    const usuario = ensureUser('tokens@tria.local');
    const outra = await criarFonte(usuario, 'orla-teste:invalid_grant');

    const resposta = await pedirToken({ coletaId: outra.coletaId });
    assert.equal(resposta.status, 409);
    assert.equal((await resposta.json()).errors.motivo, 'reauth_pending');
    assert.equal(query(`select status from integrations.connections where id = '${outra.connectionId}'`), 'reauth_pending');
  });

  it('a varredura proativa responde com o resumo', async () => {
    const resposta = await post('/api/v0/tokens/renovar-proativo', { limite: 10 });
    assert.equal(resposta.status, 200);
    const resumo = await resposta.json();
    for (const campo of ['avaliadas', 'renovadas', 'reautorizar', 'falhas']) assert.equal(typeof resumo[campo], 'number');
  });

  it('a recifragem responde com o resumo e a versão primária da chave', async () => {
    const resposta = await post('/api/v0/tokens/recifrar', { limite: 10 });
    assert.equal(resposta.status, 200);
    const resumo = await resposta.json();
    for (const campo of ['avaliadas', 'recifradas', 'falhas']) assert.equal(typeof resumo[campo], 'number');
    assert.equal(typeof resumo.versaoPrimaria, 'string');
  });
});
