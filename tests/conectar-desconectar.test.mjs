import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, describe, it } from 'node:test';
import { BASE, acaoComCampo, appIsUp, browse, ensureUser, get, makeOwner, signIn, signOut, sqlDeConexao, submitAction } from './helpers.mjs';

const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
    encoding: 'utf8',
  }).trim();

const umaLinha = (saida) => saida.split('\n')[0].trim();

const PLATAFORMAS_OAUTH = [
  'google', 'ga4', 'gtm', 'searchconsole', 'youtube', 'gbp',
  'meta', 'pixel', 'leadads', 'whatsapp',
  'rdstation',
];

const PLATAFORMAS_COM_RECURSO = [
  'ga4', 'gtm', 'searchconsole', 'youtube', 'gbp', 'pixel', 'leadads', 'rdstation', 'apify', 'zapi',
];

const PLATAFORMAS_DE_ANUNCIO = ['google', 'meta'];

const POR_CHAVE = ['rdstation', 'apify', 'zapi'];

const ESCOPO_MINIMO = {
  ga4: 'https://www.googleapis.com/auth/analytics.readonly',
  gtm: 'https://www.googleapis.com/auth/tagmanager.readonly',
  searchconsole: 'https://www.googleapis.com/auth/webmasters.readonly',
  youtube: 'https://www.googleapis.com/auth/youtube.readonly',
  gbp: 'https://www.googleapis.com/auth/business.manage',
};

const novaOrganizacao = (rotulo) =>
  umaLinha(dono(
    `INSERT INTO core.organizations (name, slug, type) VALUES ('${rotulo}', '${rotulo.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}', 'agency') RETURNING id`,
  ));

const novoCliente = (org, nome) =>
  umaLinha(dono(
    `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome}', 'leads') RETURNING id`,
  ));

function semearConexao(org, plataforma) {
  return umaLinha(dono(sqlDeConexao({
    organizationId: org,
    platform: plataforma,
    grantType: POR_CHAVE.includes(plataforma) ? 'api_key' : 'oauth_user',
    label: `Conexão ${plataforma}`,
    externalId: `id-${plataforma}`,
    scopes: ESCOPO_MINIMO[plataforma] ? [ESCOPO_MINIMO[plataforma]] : [],
    accountEmail: `dono-${plataforma}@cliente.test`,
  }).sql));
}

const estadoDoCofre = (conexao) =>
  umaLinha(dono(
    `SELECT c.status || '|' || coalesce(c.account_email, '-') || '|' ||
            (SELECT count(*) FROM integrations.connection_tokens t WHERE t.connection_id = c.id)
       FROM integrations.connections c WHERE c.id = '${conexao}'`,
  ));

const REVOGA_NO_PROVEDOR = ['google', 'ga4', 'gtm', 'searchconsole', 'youtube', 'gbp', 'meta', 'pixel', 'leadads', 'whatsapp'];

const semearRecurso = (org, conexao, plataforma) =>
  umaLinha(dono(
    `INSERT INTO integrations.connection_accounts (organization_id, connection_id, platform, external_id, name)
     VALUES ('${org}', '${conexao}', '${plataforma}', 'recurso-${plataforma}', 'Recurso ${plataforma}')
     RETURNING id`,
  ));

const estadoDoRecurso = (recurso) =>
  umaLinha(dono(
    `SELECT state || '|' || coalesce(client_id::text, '-') FROM integrations.connection_accounts WHERE id = '${recurso}'`,
  ));

const auditorias = (acao, alvo) =>
  umaLinha(dono(`SELECT count(*) FROM audit.audit_log WHERE action = '${acao}' AND target_id = '${alvo}'`));

const metadadoDaAuditoria = (acao, alvo, campo) =>
  umaLinha(dono(
    `SELECT coalesce(metadata ->> '${campo}', '-') FROM audit.audit_log
      WHERE action = '${acao}' AND target_id = '${alvo}' ORDER BY occurred_at DESC LIMIT 1`,
  ));

const naColeta = (fonte) =>
  umaLinha(dono(`SELECT count(*) FROM automation.fontes_de_coleta(200) WHERE fonte_id = '${fonte}'`));

const aprovado = (resultado) => assert.ok([200, 303].includes(resultado.status), `status inesperado: ${resultado.status}`);

describe('conectar: erro na autorização volta para as conexões com o modal, em toda plataforma OAuth', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
  });

  for (const plataforma of PLATAFORMAS_OAUTH) {
    it(`${plataforma}: state forjado volta com o motivo e a plataforma, e não leva ao onboarding`, async () => {
      const resposta = await fetch(`${BASE}/api/oauth/${plataforma}/callback?state=${plataforma}.forjado&code=qualquer`, {
        redirect: 'manual',
      });
      const destino = new URL(resposta.headers.get('location') ?? '', BASE);

      assert.equal(destino.pathname, '/integracoes');
      assert.equal(destino.searchParams.get('erroConexao'), 'estado_invalido');
      assert.equal(destino.searchParams.get('plataforma'), plataforma);
    });

    it(`${plataforma}: callback sem state e sem cookie também volta com o motivo`, async () => {
      const resposta = await fetch(`${BASE}/api/oauth/${plataforma}/callback?code=qualquer`, { redirect: 'manual' });
      const destino = new URL(resposta.headers.get('location') ?? '', BASE);

      assert.equal(destino.pathname, '/integracoes');
      assert.equal(destino.searchParams.get('erroConexao'), 'estado_invalido');
    });
  }

  it('plataforma que não fala OAuth volta com o motivo, sem sair do app', async () => {
    for (const plataforma of ['apify', 'zapi', 'tiktok']) {
      const resposta = await fetch(`${BASE}/api/oauth/${plataforma}/callback?state=x&code=y`, { redirect: 'manual' });
      const destino = new URL(resposta.headers.get('location') ?? '', BASE);

      assert.equal(destino.origin, new URL(BASE).origin);
      assert.equal(destino.pathname, '/integracoes');
      assert.equal(destino.searchParams.get('erroConexao'), 'plataforma_desconhecida');
    }
  });

  it('o início da autorização de plataforma desconhecida volta às conexões, não ao onboarding', async () => {
    const resposta = await fetch(`${BASE}/api/oauth/tiktok/start`, { redirect: 'manual' });
    const destino = new URL(resposta.headers.get('location') ?? '', BASE);
    assert.notEqual(destino.pathname, '/comecar');
  });
});

describe('recurso descoberto: vincular, mover e desvincular, em toda plataforma com recurso', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
  });

  for (const plataforma of PLATAFORMAS_COM_RECURSO) {
    it(`${plataforma}: ciclo completo na tela, com auditoria, aviso de posse e presença na coleta`, async () => {
      const org = novaOrganizacao(`Ciclo ${plataforma}`);
      const pessoa = ensureUser(`ciclo-${plataforma}@tria.local`);
      dono(`UPDATE core.members SET revoked_at = now() WHERE user_id = '${pessoa}' AND organization_id <> '${org}'`);
      makeOwner(pessoa, org);
      const clienteA = novoCliente(org, 'Credaz');
      const clienteB = novoCliente(org, 'Outro');
      const conexao = semearConexao(org, plataforma);
      const recurso = semearRecurso(org, conexao, plataforma);
      const tela = `/integracoes/conector/${plataforma}`;
      signIn(pessoa);

      try {
        assert.equal(naColeta(recurso), '0', 'recurso sem dono não pode estar na coleta');

        const vincular = await acaoComCampo(tela, 'recursoId');
        aprovado(await submitAction(tela, vincular, { recursoId: recurso, clientId: clienteA, voltarPara: tela }));
        assert.equal(estadoDoRecurso(recurso), `linked|${clienteA}`);
        assert.equal(auditorias('connection_account.link', recurso), '1');
        assert.equal(naColeta(recurso), '1', 'recurso vinculado a cliente ativo entra na coleta');
        assert.equal(
          umaLinha(dono(`SELECT client_id FROM automation.fontes_de_coleta(200) WHERE fonte_id = '${recurso}'`)),
          clienteA,
        );

        const origem = `/clientes/${clienteA}`;
        const mover = await acaoComCampo(origem, 'destinoId');
        aprovado(await submitAction(origem, mover, { clientId: clienteA, recursoId: recurso, destinoId: clienteB }));
        assert.equal(estadoDoRecurso(recurso), `linked|${clienteB}`);
        assert.equal(metadadoDaAuditoria('connection_account.reassigned', recurso, 'de'), 'Credaz');
        assert.equal(metadadoDaAuditoria('connection_account.reassigned', recurso, 'para'), 'Outro');
        assert.equal(
          umaLinha(dono(`SELECT client_id FROM automation.fontes_de_coleta(200) WHERE fonte_id = '${recurso}'`)),
          clienteB,
        );

        const desvincular = await acaoComCampo(tela, 'recursoId');
        aprovado(await submitAction(tela, desvincular, { recursoId: recurso, voltarPara: tela }));
        assert.equal(estadoDoRecurso(recurso), 'discovered|-');
        assert.equal(auditorias('connection_account.unlink', recurso), '1');
        assert.equal(metadadoDaAuditoria('connection_account.unlink', recurso, 'de'), 'Outro');
        assert.equal(naColeta(recurso), '0', 'recurso desvinculado sai da coleta');

        const depois = (await (await browse(tela)).text()).replaceAll('<!-- -->', '');
        assert.ok(depois.includes(`value="${recurso}"`), 'o recurso solto volta para a lista de contas a conectar');
      } finally {
        signOut();
      }
    });
  }
});

describe('desconectar: remover a conexão libera tudo que dependia dela, em toda plataforma', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
  });

  const todas = [...new Set([...PLATAFORMAS_OAUTH, 'apify', 'zapi'])];

  for (const plataforma of todas) {
    it(`${plataforma}: revoga no provedor, apaga o token do cofre, solta o recurso e tira da coleta e da tela`, async () => {
      const org = novaOrganizacao(`Remoção ${plataforma}`);
      const pessoa = ensureUser(`remocao-${plataforma}@tria.local`);
      dono(`UPDATE core.members SET revoked_at = now() WHERE user_id = '${pessoa}' AND organization_id <> '${org}'`);
      makeOwner(pessoa, org);
      const cliente = novoCliente(org, 'Credaz');
      const conexao = semearConexao(org, plataforma);
      const tela = `/integracoes/conector/${plataforma}`;

      const comRecurso = PLATAFORMAS_COM_RECURSO.includes(plataforma);
      const deAnuncio = PLATAFORMAS_DE_ANUNCIO.includes(plataforma);
      let recurso = null;
      let contaDeAnuncio = null;

      if (comRecurso) {
        recurso = semearRecurso(org, conexao, plataforma);
        dono(`UPDATE integrations.connection_accounts SET state = 'linked', client_id = '${cliente}' WHERE id = '${recurso}'`);
        assert.equal(naColeta(recurso), '1', 'pré-condição: o recurso vinculado está na coleta');
      }
      if (deAnuncio) {
        const externo = plataforma === 'google' ? '123-456-7890' : 'act_1234567890';
        contaDeAnuncio = umaLinha(dono(
          `INSERT INTO integrations.ad_accounts (organization_id, client_id, connection_id, platform, external_id, name)
           VALUES ('${org}', '${cliente}', '${conexao}', '${plataforma}', '${externo}', 'Conta de anúncio')
           RETURNING id`,
        ));
        assert.equal(naColeta(contaDeAnuncio), '1', 'pré-condição: a conta de anúncio está na coleta');
      }

      signIn(pessoa);
      try {
        const remover = await acaoComCampo(tela, 'connectionId');
        aprovado(await submitAction(tela, remover, { connectionId: conexao, voltarPara: tela }));

        assert.equal(estadoDoCofre(conexao), 'revoked|-|0', 'o ciphertext some junto com a revogação');
        assert.equal(auditorias('connection.removed', conexao), '1');
        assert.equal(
          metadadoDaAuditoria('connection.removed', conexao, 'revogadoNoProvedor'),
          REVOGA_NO_PROVEDOR.includes(plataforma) ? 'true' : 'nao_suportado',
        );
        assert.equal(metadadoDaAuditoria('connection.removed', conexao, 'cofreApagado'), 'true');

        if (recurso) {
          assert.equal(estadoDoRecurso(recurso), 'discovered|-');
          assert.equal(metadadoDaAuditoria('connection_account.unlink', recurso, 'de'), 'Credaz');
          assert.equal(metadadoDaAuditoria('connection_account.unlink', recurso, 'motivo'), 'connection.removed');
          assert.equal(naColeta(recurso), '0');
        }
        if (contaDeAnuncio) {
          assert.equal(
            umaLinha(dono(`SELECT status FROM integrations.ad_accounts WHERE id = '${contaDeAnuncio}'`)),
            'linked',
            'a conta de anúncio fica, com o histórico (ADR 0011)',
          );
          assert.equal(naColeta(contaDeAnuncio), '0', 'sem conexão ativa a conta de anúncio não é coletada');
        }

        const depois = await (await browse(tela)).text();
        assert.ok(!depois.includes(`value="${conexao}"`), 'a conexão removida continua na tela');
        if (recurso) assert.ok(!depois.includes(`value="${recurso}"`), 'o recurso da conexão removida continua na tela');

        const repetir = await submitAction(tela, remover, { connectionId: conexao, voltarPara: tela });
        aprovado(repetir);
        assert.equal(auditorias('connection.removed', conexao), '1', 'remover de novo não audita outra vez');
      } finally {
        signOut();
      }
    });
  }

  it('quem só opera não remove a conexão, e nada muda', async () => {
    const org = novaOrganizacao('Remoção sem permissão');
    const pessoa = ensureUser('remocao-operador@tria.local');
    dono(`UPDATE core.members SET revoked_at = now() WHERE user_id = '${pessoa}' AND organization_id <> '${org}'`);
    makeOwner(pessoa, org);
    const conexao = semearConexao(org, 'ga4');
    const tela = '/integracoes/conector/ga4';

    signIn(pessoa);
    const remover = await acaoComCampo(tela, 'connectionId');
    dono(`UPDATE core.members SET role = 'operator' WHERE user_id = '${pessoa}' AND organization_id = '${org}'`);

    const resultado = await submitAction(tela, remover, { connectionId: conexao, voltarPara: tela });
    aprovado(resultado);
    assert.equal(estadoDoCofre(conexao), 'active|dono-ga4@cliente.test|1');
    assert.equal(auditorias('connection.removed', conexao), '0');
    signOut();
  });

  it('as fontes de coleta continuam respondendo ao orquestrador depois das remoções', async () => {
    const resposta = await get('/api/v0/coleta/fontes?limit=200');
    assert.equal(resposta.status, 200);
    assert.ok(Array.isArray((await resposta.json()).fontes));
  });
});
