import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, workerHeaders } from './helpers.mjs';

function senhaDoApp() {
  return readFileSync('.env', 'utf8')
    .split('\n')
    .find((linha) => linha.startsWith('APP_DB_PASSWORD='))
    .slice('APP_DB_PASSWORD='.length);
}

const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
    encoding: 'utf8',
  }).trim();

const comoApp = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', '-e', `PGPASSWORD=${senhaDoApp()}`, 'orla-postgres',
     'psql', '-U', 'orla_app', '-h', '127.0.0.1', '-d', 'tria', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();

const umaLinha = (saida) => saida.split('\n')[0].trim();
const marca = Date.now();

describe('retenção e direitos do titular', { concurrency: false }, () => {
  let org = '';

  before(() => {
    org = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('LGPD', 'lgpd-${marca}', 'agency') RETURNING id`,
    ));
  });

  it('a retenção apaga o vencido e preserva o recente, chamada pelo papel do app', () => {
    const ipVelho = umaLinha(dono(
      `INSERT INTO audit.audit_log (organization_id, occurred_at, actor_type, action, source_ip, metadata)
       VALUES ('${org}', now() - interval '7 months', 'user', 'teste.ip', '10.0.0.1', '{}') RETURNING id`,
    ));
    const ipNovo = umaLinha(dono(
      `INSERT INTO audit.audit_log (organization_id, occurred_at, actor_type, action, source_ip, metadata)
       VALUES ('${org}', now() - interval '1 month', 'user', 'teste.ip', '10.0.0.2', '{}') RETURNING id`,
    ));
    const antigo = umaLinha(dono(
      `INSERT INTO audit.audit_log (organization_id, occurred_at, actor_type, action, metadata)
       VALUES ('${org}', now() - interval '3 years', 'user', 'teste.antigo', '{}') RETURNING id`,
    ));
    const convite = umaLinha(dono(
      `INSERT INTO core.invitations (organization_id, email, role, expires_at, revoked_at)
       VALUES ('${org}', 'convite-${marca}@cliente.test', 'viewer', now() - interval '120 days', now() - interval '100 days')
       RETURNING id`,
    ));
    const curioso = umaLinha(dono(
      `INSERT INTO core.users (email, name, created_at, last_login_at)
       VALUES ('curioso-${marca}@gmail.test', 'Curioso', now() - interval '40 days', now() - interval '40 days')
       RETURNING id`,
    ));
    const recente = umaLinha(dono(
      `INSERT INTO core.users (email, name) VALUES ('recente-${marca}@gmail.test', 'Recente') RETURNING id`,
    ));
    const aviso = umaLinha(dono(
      `INSERT INTO integrations.whatsapp_inbound_events (source, external_ref, payload, received_at)
       VALUES ('zapi', 'velho-${marca}', '{"telefone":"5581999999999"}', now() - interval '100 days') RETURNING id`,
    ));

    const resumo = JSON.parse(comoApp('SELECT core.aplicar_retencao()'));
    assert.ok(resumo.ipsApagados >= 1 && resumo.usuariosApagados >= 1 && resumo.whatsappApagados >= 1);

    assert.equal(umaLinha(dono(`SELECT coalesce(host(source_ip), '-') FROM audit.audit_log WHERE id = '${ipVelho}'`)), '-');
    assert.equal(umaLinha(dono(`SELECT host(source_ip) FROM audit.audit_log WHERE id = '${ipNovo}'`)), '10.0.0.2');
    assert.equal(umaLinha(dono(`SELECT count(*) FROM audit.audit_log WHERE id = '${antigo}'`)), '0');
    assert.equal(umaLinha(dono(`SELECT email FROM core.invitations WHERE id = '${convite}'`)), `removido+${convite}@invalid`);
    assert.equal(umaLinha(dono(`SELECT count(*) FROM core.users WHERE id = '${curioso}'`)), '0');
    assert.equal(umaLinha(dono(`SELECT count(*) FROM core.users WHERE id = '${recente}'`)), '1');
    assert.equal(umaLinha(dono(`SELECT count(*) FROM integrations.whatsapp_inbound_events WHERE id = '${aviso}'`)), '0');
  });

  it('a retenção roda pela rota de worker, só com o token do worker', async () => {
    assert.ok(await appIsUp(), 'App não está no ar');
    const semToken = await fetch(`${BASE}/api/v0/manutencao/retencao`, { method: 'POST', body: '{}' });
    assert.equal(semToken.status, 401);

    const resposta = await fetch(`${BASE}/api/v0/manutencao/retencao`, {
      method: 'POST',
      headers: workerHeaders(),
      body: '{}',
    });
    assert.equal(resposta.status, 200);
    const corpo = await resposta.json();
    assert.equal(typeof (corpo.data ?? corpo).usuariosApagados, 'number');
  });

  it('o papel do app não consegue anonimizar titular nem excluir cliente', () => {
    assert.throws(() => comoApp(`SELECT core.anonimizar_titular('alguem@x.test')`), /permission denied/);
    assert.throws(
      () => comoApp(`SELECT core.excluir_cliente('00000000-0000-0000-0000-000000000000')`),
      /permission denied/,
    );
  });

  it('anonimizar o titular revoga o acesso e tira o e-mail de usuário, convites, conexões e auditoria', () => {
    const email = `titular-${marca}@cliente.test`;
    const titular = umaLinha(dono(`INSERT INTO core.users (email, name) VALUES ('${email}', 'Titular') RETURNING id`));
    dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${org}', '${titular}', 'viewer')`);
    dono(
      `INSERT INTO audit.audit_log (organization_id, actor_type, actor_id, action, source_ip, metadata)
       VALUES ('${org}', 'user', '${titular}', 'teste.titular', '10.0.0.3', '{"email":"${email}","role":"viewer"}')`,
    );

    const resumo = JSON.parse(dono(`SELECT core.anonimizar_titular('${email.toUpperCase()}')`));
    assert.equal(resumo.usuarioEncontrado, true);
    assert.equal(resumo.vinculosRevogados, 1);

    assert.equal(umaLinha(dono(`SELECT email || '|' || name FROM core.users WHERE id = '${titular}'`)),
      `removido+${titular}@invalid|Titular removido`);
    assert.equal(umaLinha(dono(
      `SELECT count(*) FROM core.members WHERE user_id = '${titular}' AND revoked_at IS NULL`)), '0');
    assert.equal(umaLinha(dono(
      `SELECT count(*) FROM audit.audit_log WHERE metadata::text LIKE '%${email}%' OR (actor_id = '${titular}' AND source_ip IS NOT NULL)`)), '0');
  });

  it('excluir o cliente leva junto contas, acessos e coletas, e deixa um registro sem dado pessoal', () => {
    const cliente = umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', 'Saindo', 'leads') RETURNING id`,
    ));
    const conexao = umaLinha(dono(
      `INSERT INTO integrations.connections (organization_id, platform, grant_type, label, external_id, scopes, credential_ref)
       VALUES ('${org}', 'google', 'mcc', 'MCC saindo', '999-${String(marca).slice(-3)}-0001', ARRAY['adwords'], 'cred') RETURNING id`,
    ));
    dono(
      `INSERT INTO integrations.ad_accounts (organization_id, client_id, connection_id, platform, external_id, name)
       VALUES ('${org}', '${cliente}', '${conexao}', 'google', '123-${String(marca).slice(-3)}-0001', 'Conta saindo')`,
    );

    const resumo = JSON.parse(dono(`SELECT core.excluir_cliente('${cliente}')`));
    assert.equal(resumo.contas, 1);

    assert.equal(umaLinha(dono(`SELECT count(*) FROM core.clients WHERE id = '${cliente}'`)), '0');
    assert.equal(umaLinha(dono(`SELECT count(*) FROM integrations.ad_accounts WHERE client_id = '${cliente}'`)), '0');
    assert.equal(umaLinha(dono(
      `SELECT count(*) FROM audit.audit_log WHERE action = 'client.purged' AND target_id = '${cliente}'`)), '1');
  });
});
