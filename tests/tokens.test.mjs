import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createCipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, ensureUser, env, makeOwner, post, signIn, submitForm } from './helpers.mjs';

const query = (sql) =>
  execFileSync('docker', ['exec', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql])
    .toString()
    .trim()
    .split('\n')[0]
    .trim();

const WINDOW = { start: '2026-11-01', end: '2026-11-07' };

function selar(chave, texto, aad) {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  cifra.setAAD(aad);
  const corpo = Buffer.concat([cifra.update(texto), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), corpo]);
}

function envelopeLocal(texto, connectionId, platform) {
  const chaveMestra = Buffer.from(hkdfSync('sha256', env().TRIA_SESSION_SECRET, 'orla.tokens.local', 'chave-mestra-local:v1', 32));
  const aad = Buffer.from(`orla.tokens.v1|${connectionId}|${platform}|segredo`);
  const chaveDeDados = randomBytes(32);
  const selado = selar(chaveDeDados, Buffer.from(texto), aad);
  const embrulhada = selar(chaveMestra, chaveDeDados, aad);
  const tamanho = Buffer.alloc(2);
  tamanho.writeUInt16BE(embrulhada.length);
  return Buffer.concat([Buffer.from([1]), tamanho, embrulhada, selado]).toString('hex');
}

const acessoDeTeste = (segredo) => `teste-acesso-${createHash('sha256').update(segredo).digest('hex').slice(0, 24)}`;

function guardarToken(connectionId, organizationId, segredo) {
  query(
    `insert into integrations.connection_tokens (connection_id, organization_id, tipo, ciphertext, kms_key_version, algoritmo)
     values ('${connectionId}', '${organizationId}', 'oauth_refresh', decode('${envelopeLocal(segredo, connectionId, 'google')}', 'hex'),
             'local:v1', 'aes-256-gcm+local')
     on conflict (connection_id) do update set ciphertext = excluded.ciphertext, access_token_ciphertext = null,
       access_kms_key_version = null, access_expires_at = null, versao = integrations.connection_tokens.versao + 1`,
  );
}

async function criarFonte(usuario) {
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
    `insert into integrations.connections (organization_id, platform, grant_type, label, external_id, scopes, credential_ref)
     values ('${organizationId}', 'google', 'mcc', 'MCC do cofre', '${Math.floor(Math.random() * 9e9 + 1e9)}',
             array['https://www.googleapis.com/auth/adwords'], 'n8n:credential:google') returning id`,
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
  return { organizationId, connectionId, accountId, coletaId: coleta.id };
}

const pedirToken = (corpo) => post('/api/v0/coleta/token', corpo);

describe('cofre de tokens: rota do worker', { concurrency: false }, () => {
  let fonte;
  const segredo = `orla-teste:${randomUUID()}`;

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    const usuario = ensureUser('tokens@tria.local');
    signIn(usuario);
    fonte = await criarFonte(usuario);
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
  });

  it('valida o corpo e não conhece coleta inventada', async () => {
    assert.equal((await pedirToken({ coletaId: 'nao-e-uuid' })).status, 422);
    assert.equal((await pedirToken({ coletaId: fonte.coletaId, tarefaId: randomUUID() })).status, 422);
    assert.equal((await pedirToken({ coletaId: randomUUID() })).status, 404);
  });

  it('conexão sem token no cofre é recusada com 409 sem_token', async () => {
    const resposta = await pedirToken({ coletaId: fonte.coletaId });
    assert.equal(resposta.status, 409);
    assert.equal((await resposta.json()).errors.motivo, 'sem_token');
  });

  it('devolve o access token renovado pelo provedor de teste, sem cache HTTP e sem token na auditoria', async () => {
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
    query(`update integrations.connections set status = 'active' where id = '${fonte.connectionId}'`);
  });

  it('coleta encerrada é recusada', async () => {
    query(`update automation.coletas set status = 'failed', finished_at = now() where id = '${fonte.coletaId}'`);
    const resposta = await pedirToken({ coletaId: fonte.coletaId });
    assert.equal(resposta.status, 409);
    assert.equal((await resposta.json()).errors.motivo, 'origem_encerrada');
  });

  it('invalid_grant do provedor marca a conexão como reauth_pending', async () => {
    const usuario = ensureUser('tokens@tria.local');
    const outra = await criarFonte(usuario);
    guardarToken(outra.connectionId, outra.organizationId, 'orla-teste:invalid_grant');

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
});
