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

  it('o papel do app não consegue anonimizar titular nem excluir, restaurar ou expurgar cliente', () => {
    const nenhum = `'00000000-0000-0000-0000-000000000000'`;
    assert.throws(() => comoApp(`SELECT core.anonimizar_titular('alguem@x.test')`), /permission denied/);
    assert.throws(() => comoApp(`SELECT core.excluir_cliente(${nenhum}, 'app')`), /permission denied/);
    assert.throws(() => comoApp(`SELECT core.restaurar_cliente(${nenhum}, 'app')`), /permission denied/);
    assert.throws(() => comoApp(`SELECT core.expurgar_cliente(${nenhum})`), /permission denied/);
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

  const clienteComConta = (nome, sufixo) => {
    const cliente = umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome}', 'leads') RETURNING id`,
    ));
    const conexao = umaLinha(dono(
      `INSERT INTO integrations.connections (organization_id, platform, grant_type, label, external_id, scopes, credential_ref)
       VALUES ('${org}', 'google', 'mcc', 'MCC ${nome}', '999-${String(marca).slice(-3)}-${sufixo}', ARRAY['adwords'], 'cred') RETURNING id`,
    ));
    const conta = umaLinha(dono(
      `INSERT INTO integrations.ad_accounts (organization_id, client_id, connection_id, platform, external_id, name)
       VALUES ('${org}', '${cliente}', '${conexao}', 'google', '123-${String(marca).slice(-3)}-${sufixo}', 'Conta ${nome}')
       RETURNING id`,
    ));
    return { cliente, conta, conexao };
  };

  const naOrganizacao = (sql) => comoApp(`SET app.organization_id = '${org}'; SET app.client_ids = '*'; ${sql}`);

  it('excluir o cliente é lógico: some do app, sai da coleta, revoga convites e nada é apagado', () => {
    const { cliente, conta } = clienteComConta('Saindo', '0001');
    const convite = umaLinha(dono(
      `INSERT INTO integrations.connection_invites (organization_id, client_id, kind, token, expires_at)
       VALUES ('${org}', '${cliente}', 'oauth_self_service', 'tok-${marca}-saindo', now() + interval '7 days') RETURNING id`,
    ));
    assert.equal(umaLinha(naOrganizacao(`SELECT count(*) FROM integrations.ad_accounts WHERE id = '${conta}'`)), '1');

    const resumo = JSON.parse(dono(`SELECT core.excluir_cliente('${cliente}', 'teste')`));
    assert.equal(resumo.contas, 1);
    assert.equal(resumo.convitesRevogados, 1);

    assert.equal(umaLinha(dono(
      `SELECT status || '|' || (excluido_em IS NOT NULL) || '|' || excluido_por FROM core.clients WHERE id = '${cliente}'`)),
      'archived|true|teste');
    assert.equal(umaLinha(dono(`SELECT count(*) FROM integrations.ad_accounts WHERE client_id = '${cliente}'`)), '1');
    assert.equal(umaLinha(dono(`SELECT status FROM integrations.connection_invites WHERE id = '${convite}'`)), 'revoked');
    assert.equal(umaLinha(dono(
      `SELECT count(*) FROM audit.audit_log WHERE action = 'client.excluded' AND target_id = '${cliente}'`)), '1');

    assert.equal(umaLinha(naOrganizacao(`SELECT count(*) FROM core.clients WHERE id = '${cliente}'`)), '0');
    assert.equal(umaLinha(naOrganizacao(`SELECT count(*) FROM integrations.ad_accounts WHERE id = '${conta}'`)), '0');
    assert.equal(umaLinha(naOrganizacao(`SELECT count(*) FROM integrations.connection_invites WHERE id = '${convite}'`)), '0');
    assert.equal(umaLinha(dono(`SELECT count(*) FROM automation.fontes_de_coleta(200) WHERE client_id = '${cliente}'`)), '0');
    assert.equal(umaLinha(dono(
      `SELECT status FROM automation.dimensao_clientes() WHERE client_id = '${cliente}' AND excluido_em IS NOT NULL`)), 'archived');

    assert.throws(() => dono(`SELECT core.excluir_cliente('${cliente}', 'teste')`), /já foi excluído/);
  });

  it('um cliente excluído não impede cadastrar outro com o mesmo nome, e restaurar confere a colisão', () => {
    const { cliente } = clienteComConta('Volta', '0002');
    dono(`SELECT core.excluir_cliente('${cliente}', 'teste')`);
    const homonimo = umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', 'Volta', 'leads') RETURNING id`,
    ));
    assert.throws(() => dono(`SELECT core.restaurar_cliente('${cliente}', 'teste')`), /já existe cliente ativo/);

    dono(`UPDATE core.clients SET name = 'Volta (novo)' WHERE id = '${homonimo}'`);
    const resumo = JSON.parse(dono(`SELECT core.restaurar_cliente('${cliente}', 'teste')`));
    assert.equal(resumo.status, 'paused');
    assert.equal(umaLinha(naOrganizacao(`SELECT status FROM core.clients WHERE id = '${cliente}'`)), 'paused');
    assert.equal(umaLinha(dono(
      `SELECT count(*) FROM audit.audit_log WHERE action = 'client.restored' AND target_id = '${cliente}'`)), '1');
  });

  it('expurgar o cliente leva junto contas, acessos e coletas, e deixa um registro sem dado pessoal', () => {
    const { cliente } = clienteComConta('Expurgo', '0003');

    const resumo = JSON.parse(dono(`SELECT core.expurgar_cliente('${cliente}')`));
    assert.equal(resumo.contas, 1);

    assert.equal(umaLinha(dono(`SELECT count(*) FROM core.clients WHERE id = '${cliente}'`)), '0');
    assert.equal(umaLinha(dono(`SELECT count(*) FROM integrations.ad_accounts WHERE client_id = '${cliente}'`)), '0');
    assert.equal(umaLinha(dono(
      `SELECT count(*) FROM audit.audit_log WHERE action = 'client.purged' AND target_id = '${cliente}'`)), '1');
  });

  it('expurgar tira o nome do cliente da trilha e devolve os recursos dele a descoberto', () => {
    const { cliente, conta, conexao } = clienteComConta('Purga', '0004');
    const recurso = umaLinha(dono(
      `INSERT INTO integrations.connection_accounts (organization_id, connection_id, platform, external_id, name, state, client_id)
       VALUES ('${org}', '${conexao}', 'rdstation', 'rd-${marca}', 'RD Purga', 'linked', '${cliente}') RETURNING id`,
    ));
    const espelho = umaLinha(dono(
      `INSERT INTO integrations.connection_accounts (organization_id, connection_id, platform, external_id, name, state, ad_account_id)
       VALUES ('${org}', '${conexao}', 'google', 'g-${marca}', 'Conta Purga', 'linked', '${conta}') RETURNING id`,
    ));
    const movida = umaLinha(dono(
      `INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
       VALUES ('${org}', 'user', 'ad_account.reassigned', 'ad_account', '${conta}',
               '{"de": "Purga", "deId": "${cliente}", "para": "Outro"}') RETURNING id`,
    ));
    const criado = umaLinha(dono(
      `INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
       VALUES ('${org}', 'user', 'client.created', 'client', '${cliente}', '{"name": "Purga"}') RETURNING id`,
    ));

    const resumo = JSON.parse(dono(`SELECT core.expurgar_cliente('${cliente}')`));
    assert.equal(resumo.recursosLiberados, 2);
    assert.equal(resumo.auditoriaAnonimizada, 2);

    assert.equal(umaLinha(dono(
      `SELECT state || '|' || (client_id IS NULL) || '|' || (ad_account_id IS NULL)
       FROM integrations.connection_accounts WHERE id = '${recurso}'`)), 'discovered|true|true');
    assert.equal(umaLinha(dono(`SELECT state FROM integrations.connection_accounts WHERE id = '${espelho}'`)), 'discovered');
    assert.equal(umaLinha(dono(
      `SELECT (metadata ->> 'de') || '|' || (metadata ->> 'para') FROM audit.audit_log WHERE id = '${movida}'`)),
      '[cliente expurgado]|Outro');
    assert.equal(umaLinha(dono(`SELECT metadata ->> 'name' FROM audit.audit_log WHERE id = '${criado}'`)), '[cliente expurgado]');
    assert.equal(umaLinha(dono(
      `SELECT count(*) FROM audit.audit_log WHERE organization_id = '${org}' AND metadata::text LIKE '%"Purga"%'`)), '0');
  });

  it('expurgar um cliente não apaga o nome da trilha do homônimo', () => {
    const { cliente: saindo } = clienteComConta('Gemeo', '0007');
    dono(`SELECT core.excluir_cliente('${saindo}', 'teste')`);
    const { cliente: fica, conta } = clienteComConta('Gemeo', '0008');
    const doHomonimo = umaLinha(dono(
      `INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
       VALUES ('${org}', 'user', 'ad_account.reassigned', 'ad_account', '${conta}',
               '{"de": "Gemeo", "deId": "${fica}", "para": "Outro"}') RETURNING id`,
    ));
    const legado = umaLinha(dono(
      `INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
       VALUES ('${org}', 'user', 'ad_account.reassigned', 'ad_account', '${conta}', '{"de": "Gemeo"}') RETURNING id`,
    ));

    dono(`SELECT core.expurgar_cliente('${saindo}')`);

    assert.equal(umaLinha(dono(`SELECT metadata ->> 'de' FROM audit.audit_log WHERE id = '${doHomonimo}'`)), 'Gemeo');
    assert.equal(umaLinha(dono(`SELECT metadata ->> 'de' FROM audit.audit_log WHERE id = '${legado}'`)), 'Gemeo');
  });

  it('o dono anterior vem do deId; nome antigo repetido entre clientes fica desconhecido', () => {
    const { cliente: antigo } = clienteComConta('Homonimo', '0005');
    dono(`SELECT core.excluir_cliente('${antigo}', 'teste')`);
    const { conta } = clienteComConta('Homonimo', '0006');
    const externo = umaLinha(dono(`SELECT external_id FROM integrations.ad_accounts WHERE id = '${conta}'`));
    dono(
      `INSERT INTO audit.audit_log (organization_id, occurred_at, actor_type, action, target_type, target_id, metadata) VALUES
       ('${org}', now() - interval '2 days', 'user', 'ad_account.reassigned', 'ad_account', '${conta}', '{"de": "Homonimo"}'),
       ('${org}', now() - interval '1 day', 'user', 'ad_account.reassigned', 'ad_account', '${conta}',
        '{"de": "Homonimo", "deId": "${antigo}"}')`,
    );
    const linhas = dono(
      `SELECT dono_conhecido || '|' || coalesce(client_id_anterior::text, '-')
       FROM automation.dimensao_mudancas_de_posse() WHERE external_id = '${externo}' ORDER BY em`,
    ).split('\n');
    assert.deepEqual(linhas, ['false|-', `true|${antigo}`]);
  });
});
