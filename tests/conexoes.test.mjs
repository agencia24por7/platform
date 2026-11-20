import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { BASE, acaoComCampo, appIsUp, browse, ensureUser, get, makeOwner, signIn, signOut, submitAction } from './helpers.mjs';

const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
    encoding: 'utf8',
  }).trim();

const umaLinha = (saida) => saida.split('\n')[0].trim();

const aplicarMigracao = (arquivo) =>
  execFileSync(
    'docker',
    ['exec', '-i', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: readFileSync(arquivo), encoding: 'utf8' },
  );

describe('remover uma conexão', { concurrency: false }, () => {
  let org = '';
  let conexao = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');

    org = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Remoção', 'remocao-${Date.now()}', 'agency') RETURNING id`,
    ));
    const pessoa = ensureUser('remove@tria.local');
    dono(`UPDATE core.members SET revoked_at = now() WHERE user_id = '${pessoa}' AND organization_id <> '${org}'`);
    makeOwner(pessoa, org);
    conexao = umaLinha(dono(
      `INSERT INTO integrations.connections
         (organization_id, platform, grant_type, label, external_id, scopes, credential_ref, account_email, coletor_ref)
       VALUES ('${org}', 'ga4', 'oauth_user', 'GA4 para remover', 'ga4-remover',
               ARRAY['https://www.googleapis.com/auth/analytics.readonly'], 'n8n:credential:remover',
               'dono@cliente.test', 'wfColetorRemover')
       RETURNING id`,
    ));
    signIn(pessoa);
  });

  it('o papel do app consegue revogar: a conexão sai da tela e não guarda mais nada que identifique ou dê acesso', async () => {
    const remover = await acaoComCampo('/integracoes/conector/ga4', 'connectionId');
    const resultado = await submitAction('/integracoes/conector/ga4', remover, {
      connectionId: conexao,
      voltarPara: '/integracoes/conector/ga4',
    });
    assert.ok([200, 303].includes(resultado.status), `status inesperado: ${resultado.status}`);

    const linha = umaLinha(dono(
      `SELECT status || '|' || credential_ref || '|' || coalesce(account_email, '-') || '|' || coalesce(coletor_ref, '-')
         FROM integrations.connections WHERE id = '${conexao}'`,
    ));
    assert.equal(linha, 'revoked|descartada|-|-');

    const auditado = umaLinha(dono(
      `SELECT count(*) FROM audit.audit_log WHERE action = 'connection.removed' AND target_id = '${conexao}'`,
    ));
    assert.equal(auditado, '1');

    const tela = await (await browse('/integracoes/conector/ga4')).text();
    assert.ok(!tela.includes('ga4-remover'), 'conexão revogada continua listada');
  });

  it('remover de novo não acha a conexão', async () => {
    const tela = await (await browse('/integracoes/conector/ga4')).text();
    assert.ok(!tela.includes(`value="${conexao}"`));
    signOut();
  });
});

describe('sair encerra a sessão de verdade', { concurrency: false }, () => {
  it('um cookie copiado antes do logout deixa de valer depois dele', async () => {
    const pessoa = ensureUser('sair@tria.local');
    const org = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Sair', 'sair-${Date.now()}', 'agency') RETURNING id`,
    ));
    makeOwner(pessoa, org);
    const cookie = signIn(pessoa);
    await new Promise((resolver) => setTimeout(resolver, 20));

    assert.equal((await browse('/clientes')).status, 200);

    const saida = await fetch(`${BASE}/api/auth/sair`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: BASE },
      redirect: 'manual',
    });
    assert.equal(saida.status, 303);

    const depois = await browse('/clientes');
    assert.ok([302, 307].includes(depois.status), `sessão antiga ainda vale: ${depois.status}`);
    signOut();
  });
});

describe('conta do RD Station guardada por chave ganha cliente dono', { concurrency: false }, () => {
  const tela = '/integracoes/conector/rdstation';
  let org = '';
  let cliente = '';
  let conexao = '';
  let recurso = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');

    org = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Agência RD', 'agencia-rd-${Date.now()}', 'agency') RETURNING id`,
    ));
    const pessoa = ensureUser('rdstation@tria.local');
    dono(`UPDATE core.members SET revoked_at = now() WHERE user_id = '${pessoa}' AND organization_id <> '${org}'`);
    makeOwner(pessoa, org);
    cliente = umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', 'Credaz', 'leads') RETURNING id`,
    ));
    conexao = umaLinha(dono(
      `INSERT INTO integrations.connections
         (organization_id, platform, grant_type, label, external_id, scopes, credential_ref)
       VALUES ('${org}', 'rdstation', 'api_key', 'RD Station CRM · abcd••••wxyz', 'principal',
               ARRAY[]::text[], 'n8n:credential:rd-teste')
       RETURNING id`,
    ));
    signIn(pessoa);
  });

  it('a migração dá à chave já guardada uma conta vinculável, sem duplicar se rodar de novo', () => {
    aplicarMigracao('db/migrations/0040_conta_da_chave_de_api.sql');
    aplicarMigracao('db/migrations/0040_conta_da_chave_de_api.sql');

    const linhas = dono(
      `SELECT id || '|' || state || '|' || external_id || '|' || name || '|' || coalesce(client_id::text, '-')
         FROM integrations.connection_accounts WHERE connection_id = '${conexao}'`,
    ).split('\n').filter(Boolean);
    assert.equal(linhas.length, 1);
    const [id, ...resto] = linhas[0].split('|');
    recurso = id;
    assert.deepEqual(resto, ['discovered', 'principal', 'RD Station CRM · abcd••••wxyz', '-']);
  });

  it('a tela do RD Station oferece a conta e vincula ao cliente escolhido', async () => {
    const antes = (await (await browse(tela)).text()).replaceAll('<!-- -->', '');
    assert.ok(antes.includes('Conectar conta'), 'a tela não oferece vincular a conta');
    assert.ok(antes.includes(`value="${recurso}"`), 'a conta da chave não aparece para vincular');

    const vincular = await acaoComCampo(tela, 'recursoId');
    const resultado = await submitAction(tela, vincular, { recursoId: recurso, clientId: cliente, voltarPara: tela });
    assert.ok([200, 303].includes(resultado.status), `status inesperado: ${resultado.status}`);

    const linha = umaLinha(dono(
      `SELECT state || '|' || coalesce(client_id::text, '-') FROM integrations.connection_accounts WHERE id = '${recurso}'`,
    ));
    assert.equal(linha, `linked|${cliente}`);

    const auditado = umaLinha(dono(
      `SELECT count(*) FROM audit.audit_log WHERE action = 'connection_account.link' AND target_id = '${recurso}'`,
    ));
    assert.equal(auditado, '1');

    const depois = (await (await browse(tela)).text()).replaceAll('<!-- -->', '');
    assert.ok(depois.includes('Contas vinculadas'));
    assert.ok(depois.includes(`/clientes/${cliente}`), 'o cliente dono não aparece ao lado da conta');
  });

  it('a conta vinculada não entra na fila do orquestrador: o RD Station ainda não tem coletor', async () => {
    const resposta = await get('/api/v0/coleta/fontes?limit=200').then((r) => r.json());
    assert.ok(Array.isArray(resposta.fontes));
    assert.ok(!resposta.fontes.some((fonte) => fonte.fonteId === recurso));
    assert.ok(!resposta.fontes.some((fonte) => fonte.platform === 'rdstation'));
  });

  it('remover a conexão revoga a chave e mantém o vínculo como histórico, fora da coleta', async () => {
    const remover = await acaoComCampo(tela, 'connectionId');
    const resultado = await submitAction(tela, remover, { connectionId: conexao, voltarPara: tela });
    assert.ok([200, 303].includes(resultado.status), `status inesperado: ${resultado.status}`);

    assert.equal(
      umaLinha(dono(`SELECT status || '|' || credential_ref FROM integrations.connections WHERE id = '${conexao}'`)),
      'revoked|descartada',
    );
    assert.equal(
      umaLinha(dono(`SELECT state || '|' || client_id FROM integrations.connection_accounts WHERE id = '${recurso}'`)),
      `linked|${cliente}`,
    );
    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM automation.fontes_de_coleta(200) WHERE fonte_id = '${recurso}'`)),
      '0',
    );
    signOut();
  });
});

describe('erro na autorização volta para as conexões com o modal', { concurrency: false }, () => {
  it('state que não bate leva às conexões, e não ao onboarding, com o motivo no modal', async () => {
    const resposta = await fetch(`${BASE}/api/oauth/meta/callback?state=meta.forjado&code=qualquer`, { redirect: 'manual' });
    const destino = new URL(resposta.headers.get('location') ?? '', BASE);

    assert.equal(destino.pathname, '/integracoes');
    assert.equal(destino.searchParams.get('erroConexao'), 'estado_invalido');
    assert.equal(destino.searchParams.get('plataforma'), 'meta');

    const pessoa = ensureUser('modal@tria.local');
    const org = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Modal', 'modal-${Date.now()}', 'agency') RETURNING id`,
    ));
    makeOwner(pessoa, org);
    signIn(pessoa);
    const tela = await (await browse(`${destino.pathname}${destino.search}`)).text();
    assert.match(tela, /A conexão não foi concluída/);
    assert.match(tela, /outra aba/);
    signOut();
  });
});
