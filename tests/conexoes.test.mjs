import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { BASE, acaoComCampo, appIsUp, browse, ensureUser, get, makeOwner, signIn, signOut, sqlDeConexao, submitAction } from './helpers.mjs';
import { PG_CONTAINER } from './apoio/pgContainer.mjs';
import { psqlComoDono as dono, sufixoUnico } from './apoio/psql.mjs';

const umaLinha = (saida) => saida.split('\n')[0].trim();

const aplicarMigracao = (arquivo) =>
  execFileSync(
    'docker',
    ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', 'tria', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: readFileSync(arquivo), encoding: 'utf8' },
  );

describe('remover uma conexão', { concurrency: false }, () => {
  let org = '';
  let conexao = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');

    org = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Remoção', 'remocao-${sufixoUnico()}', 'agency') RETURNING id`,
    ));
    const pessoa = ensureUser('remove@tria.local');
    dono(`UPDATE core.members SET revoked_at = now() WHERE user_id = '${pessoa}' AND organization_id <> '${org}'`);
    makeOwner(pessoa, org);
    conexao = umaLinha(dono(sqlDeConexao({
      organizationId: org,
      platform: 'ga4',
      label: 'GA4 para remover',
      externalId: 'ga4-remover',
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      accountEmail: 'dono@cliente.test',
    }).sql));
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
      `SELECT status || '|' || coalesce(account_email, '-') || '|' ||
              (SELECT count(*) FROM integrations.connection_tokens WHERE connection_id = '${conexao}')
         FROM integrations.connections WHERE id = '${conexao}'`,
    ));
    assert.equal(linha, 'revoked|-|0');

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
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Sair', 'sair-${sufixoUnico()}', 'agency') RETURNING id`,
    ));
    makeOwner(pessoa, org);
    const cookie = signIn(pessoa);
    let antes = await browse('/clientes');
    for (let tentativa = 0; tentativa < 50 && antes.status !== 200; tentativa += 1) {
      await new Promise((resolver) => setTimeout(resolver, 20));
      antes = await browse('/clientes');
    }
    assert.equal(antes.status, 200, 'sessão recém-emitida deve valer antes do logout');

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
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Agência RD', 'agencia-rd-${sufixoUnico()}', 'agency') RETURNING id`,
    ));
    const pessoa = ensureUser('rdstation@tria.local');
    dono(`UPDATE core.members SET revoked_at = now() WHERE user_id = '${pessoa}' AND organization_id <> '${org}'`);
    makeOwner(pessoa, org);
    cliente = umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', 'Credaz', 'leads') RETURNING id`,
    ));
    conexao = umaLinha(dono(sqlDeConexao({
      organizationId: org,
      platform: 'rdstation',
      grantType: 'api_key',
      label: 'RD Station CRM · abcd••••wxyz',
      externalId: 'principal',
    }).sql));
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

  it('a conta vinculada entra na fila do orquestrador como fonte do RD Station, com o cliente dono', async () => {
    const resposta = await get('/api/v0/coleta/fontes?limit=200').then((r) => r.json());
    assert.ok(Array.isArray(resposta.fontes));
    const fonte = resposta.fontes.find((candidata) => candidata.fonteId === recurso);
    assert.ok(fonte, 'a conta do RD Station vinculada não aparece nas fontes de coleta');
    assert.equal(fonte.platform, 'rdstation');
    assert.equal(fonte.fonteTipo, 'connection_account');
    assert.equal(fonte.clientId, cliente);
  });

  it('remover a conexão revoga a chave, solta a conta do cliente e tira a conta da tela e da coleta', async () => {
    const remover = await acaoComCampo(tela, 'connectionId');
    const resultado = await submitAction(tela, remover, { connectionId: conexao, voltarPara: tela });
    assert.ok([200, 303].includes(resultado.status), `status inesperado: ${resultado.status}`);

    assert.equal(
      umaLinha(dono(
        `SELECT status || '|' || (SELECT count(*) FROM integrations.connection_tokens WHERE connection_id = '${conexao}')
           FROM integrations.connections WHERE id = '${conexao}'`,
      )),
      'revoked|0',
    );
    assert.equal(
      umaLinha(dono(
        `SELECT state || '|' || coalesce(client_id::text, '-') FROM integrations.connection_accounts WHERE id = '${recurso}'`,
      )),
      'discovered|-',
    );
    assert.equal(
      umaLinha(dono(
        `SELECT metadata ->> 'de' || '|' || (metadata ->> 'motivo') FROM audit.audit_log
          WHERE action = 'connection_account.unlink' AND target_id = '${recurso}'`,
      )),
      'Credaz|connection.removed',
    );
    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM automation.fontes_de_coleta(200) WHERE fonte_id = '${recurso}'`)),
      '0',
    );
    const depois = await (await browse(tela)).text();
    assert.ok(!depois.includes(`value="${recurso}"`), 'a conta da conexão removida continua na tela');
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
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Modal', 'modal-${sufixoUnico()}', 'agency') RETURNING id`,
    ));
    makeOwner(pessoa, org);
    signIn(pessoa);
    const tela = await (await browse(`${destino.pathname}${destino.search}`)).text();
    assert.match(tela, /A conexão não foi concluída/);
    assert.match(tela, /outra aba/);
    signOut();
  });
});
