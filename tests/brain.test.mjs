import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, get, post, workerHeaders } from './helpers.mjs';

const query = (sql) =>
  execFileSync('docker', ['exec', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql])
    .toString()
    .trim()
    .split('\n')[0]
    .trim();

function senhaDoApp() {
  return readFileSync('.env', 'utf8')
    .split('\n')
    .find((linha) => linha.startsWith('APP_DB_PASSWORD='))
    .slice('APP_DB_PASSWORD='.length);
}

const comoApp = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', '-e', `PGPASSWORD=${senhaDoApp()}`, 'orla-postgres', 'psql', '-U', 'orla_app', '-h', '127.0.0.1', '-d', 'tria', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim().split('\n').pop().trim();

const sufixo = () => randomUUID().slice(0, 8);
const catalogo = (cliente, resto = '') => `/api/v0/brain/clientes/${cliente}/catalogo${resto}`;

function semear() {
  const s = sufixo();
  const org = query(`insert into core.organizations (name, slug, type) values ('Agência brain ${s}', 'brain-${s}', 'agency') returning id`);
  const cliente = query(`insert into core.clients (organization_id, name, business_model) values ('${org}', 'Cliente brain ${s}', 'leads') returning id`);
  const vizinho = query(`insert into core.clients (organization_id, name, business_model) values ('${org}', 'Vizinho brain ${s}', 'leads') returning id`);
  const conexao = query(
    `insert into integrations.connections (organization_id, platform, grant_type, label, external_id, credential_ref)
     values ('${org}', 'meta', 'oauth_user', 'BM brain', 'bm-${s}', 'n8n:credential:segredo-${s}') returning id`,
  );
  const conta = query(
    `insert into integrations.ad_accounts (organization_id, client_id, connection_id, platform, external_id, name)
     values ('${org}', '${cliente}', '${conexao}', 'meta', 'act_${s}', 'Conta brain') returning id`,
  );
  const contaVizinha = query(
    `insert into integrations.ad_accounts (organization_id, client_id, connection_id, platform, external_id, name)
     values ('${org}', '${vizinho}', '${conexao}', 'meta', 'act_v${s}', 'Conta vizinha') returning id`,
  );
  const coleta = (de, ate, status, chave) =>
    query(
      `insert into automation.coletas (organization_id, client_id, platform, fonte_tipo, ad_account_id, mode, idempotency_key, status,
         window_start, window_end, started_at, finished_at)
       values ('${org}', '${cliente}', 'meta', 'ad_account', '${conta}', 'incremental', 'brain-${chave}-${s}', '${status}',
         '${de}', '${ate}', now() - interval '2 hours', now() - interval '1 hour') returning id`,
    );
  coleta('2026-01-01', '2026-01-10', 'success', 'a');
  coleta('2026-01-15', '2026-01-20', 'success', 'b');
  coleta('2026-01-21', '2026-01-21', 'failed', 'c');
  return { org, cliente, vizinho, conexao, conta, contaVizinha, s };
}

describe('company brain: API de catálogo para agentes', { concurrency: false }, () => {
  let dados;

  before(async () => {
    assert.ok(await appIsUp(), 'App não está no ar');
    dados = semear();
  });

  it('sem token de worker responde 401', async () => {
    const resposta = await fetch(`${BASE}${catalogo(dados.cliente)}`);
    assert.equal(resposta.status, 401);
  });

  it('cliente inexistente ou id inválido responde 404', async () => {
    assert.equal((await get(catalogo(randomUUID()))).status, 404);
    assert.equal((await get(catalogo('nao-e-uuid'))).status, 404);
  });

  it('devolve o catálogo do cliente com schemaVersion, ETag e 304', async () => {
    const resposta = await get(catalogo(dados.cliente, '?limite=200'));
    assert.equal(resposta.status, 200);
    const etag = resposta.headers.get('etag');
    assert.ok(etag);
    const corpo = await resposta.json();
    assert.equal(corpo.schemaVersion, 1);
    assert.equal(corpo.clienteId, dados.cliente);
    const urns = corpo.entradas.map((e) => e.urn);
    assert.ok(urns.includes(`orla:${dados.org}:${dados.cliente}:fonte:${dados.conta}`));
    assert.ok(urns.includes(`orla:${dados.org}:${dados.cliente}:tabela_de_dados:fato_ads_diario`));
    assert.ok(urns.some((u) => u.includes(':capacidade:')));
    const texto = JSON.stringify(corpo);
    assert.ok(!texto.includes(dados.vizinho), 'nada do cliente vizinho');
    assert.ok(!texto.includes(dados.contaVizinha), 'nada da conta do vizinho');
    assert.ok(!texto.includes('segredo'), 'nunca a credencial');

    const repetida = await fetch(`${BASE}${catalogo(dados.cliente, '?limite=200')}`, { headers: { ...workerHeaders(), 'If-None-Match': etag } });
    assert.equal(repetida.status, 304);
  });

  it('cobertura da fonte vem das coletas (janelas com sucesso e lacuna)', async () => {
    const urn = `orla:${dados.org}:${dados.cliente}:fonte:${dados.conta}`;
    const resposta = await get(`/api/v0/brain/clientes/${dados.cliente}/entradas/${encodeURIComponent(urn)}`);
    assert.equal(resposta.status, 200);
    const fonte = await resposta.json();
    assert.equal(fonte.cobertura.fonteDaMedida, 'coletas');
    assert.equal(fonte.cobertura.desde, '2026-01-01');
    assert.equal(fonte.cobertura.ate, '2026-01-20');
    assert.deepEqual(fonte.cobertura.lacunas[0], { de: '2026-01-11', ate: '2026-01-14', dias: 4 });
    assert.equal(fonte.frescor.status, 'parado');
  });

  it('entrada de outro cliente responde 404, mesmo pela rota do cliente certo', async () => {
    const alheia = `orla:${dados.org}:${dados.vizinho}:fonte:${dados.contaVizinha}`;
    assert.equal((await get(`/api/v0/brain/clientes/${dados.cliente}/entradas/${encodeURIComponent(alheia)}`)).status, 404);
  });

  it('filtros, validação e paginação', async () => {
    const tabelas = await (await get(catalogo(dados.cliente, '?tipo=tabela_de_dados&limite=2'))).json();
    assert.equal(tabelas.entradas.length, 2);
    assert.ok(tabelas.entradas.every((e) => e.tipo === 'tabela_de_dados'));
    assert.ok(tabelas.proximoCursor);
    const segunda = await (await get(catalogo(dados.cliente, `?tipo=tabela_de_dados&limite=2&cursor=${tabelas.proximoCursor}`))).json();
    assert.ok(segunda.entradas[0].urn > tabelas.entradas[1].urn);
    assert.equal((await get(catalogo(dados.cliente, '?limite=999'))).status, 422);
    assert.equal((await get(catalogo(dados.cliente, '?inventado=1'))).status, 422);
  });

  it('capacidades, diagnóstico e manifesto respondem com o mesmo hash', async () => {
    const [cap, dia, man] = await Promise.all(['capacidades', 'diagnostico', 'manifest'].map((r) => get(`/api/v0/brain/clientes/${dados.cliente}/${r}`)));
    assert.deepEqual([cap.status, dia.status, man.status], [200, 200, 200]);
    const [c, d, m] = await Promise.all([cap.json(), dia.json(), man.json()]);
    assert.equal(c.catalogHash, m.catalogHash);
    assert.equal(d.catalogHash, m.catalogHash);
    assert.ok(d.acoes.length > 0);
    assert.equal(d.conectores.find((x) => x.plataforma === 'meta').estado, 'conectado');
  });

  it('a consulta fica na auditoria só com contagens', () => {
    const metadata = query(
      `select metadata::text from audit.audit_log where action = 'brain.consulta' and target_id = '${dados.cliente}' order by occurred_at desc limit 1`,
    );
    const json = JSON.parse(metadata);
    assert.ok('total' in json && 'devolvidas' in json);
    assert.ok(!metadata.includes('orla:'), 'sem payload');
  });

  it('cliente excluído logicamente responde 404', async () => {
    query(`update core.clients set excluido_em = now(), excluido_por = 'teste brain' where id = '${dados.vizinho}'`);
    assert.equal((await get(catalogo(dados.vizinho))).status, 404);
  });

  it('varredura de publicação e medição de cobertura respondem pela rota de worker', async () => {
    assert.equal((await fetch(`${BASE}/api/v0/brain/publicar-pendentes`, { method: 'POST', body: '{}' })).status, 401);
    const publicar = await post('/api/v0/brain/publicar-pendentes', { limite: 5 });
    assert.equal(publicar.status, 200);
    const resumo = await publicar.json();
    assert.equal(typeof resumo.publicados, 'number');
    const medir = await post('/api/v0/brain/cobertura/medir', { limite: 1 });
    assert.ok([200, 503].includes(medir.status), `status ${medir.status}`);
  });
});

describe('company brain: estado da publicação no Postgres', { concurrency: false }, () => {
  it('RLS: outra organização não vê o estado nem a cobertura', () => {
    const d = semear();
    query(`insert into core.client_brain_catalog_state (client_id, organization_id) values ('${d.cliente}', '${d.org}') on conflict do nothing`);
    query(`insert into core.client_brain_coverage (client_id, organization_id, tabela, linhas) values ('${d.cliente}', '${d.org}', 'fato_ads_diario', 1)`);
    const outra = randomUUID();
    const contar = (tabela, org) =>
      comoApp(`select set_config('app.organization_id', '${org}', true); select set_config('app.client_ids', '*', true);
               select count(*) from core.${tabela} where client_id = '${d.cliente}';`);
    assert.equal(contar('client_brain_catalog_state', outra), '0');
    assert.equal(contar('client_brain_coverage', outra), '0');
    assert.equal(contar('client_brain_catalog_state', d.org), '1');
    const gravouAlheio = (() => {
      try {
        comoApp(`select set_config('app.organization_id', '${outra}', true); select set_config('app.client_ids', '*', true);
                 insert into core.client_brain_catalog_state (client_id, organization_id) values ('${d.vizinho}', '${d.org}');`);
        return true;
      } catch {
        return false;
      }
    })();
    assert.equal(gravouAlheio, false);
  });

  it('expurgar o cliente apaga o estado e a cobertura em cascata', () => {
    const d = semear();
    query(`insert into core.client_brain_catalog_state (client_id, organization_id) values ('${d.cliente}', '${d.org}')`);
    query(`insert into core.client_brain_coverage (client_id, organization_id, tabela, linhas) values ('${d.cliente}', '${d.org}', 'fato_ads_diario', 1)`);
    query(`delete from automation.coletas where client_id = '${d.cliente}'`);
    query(`delete from integrations.ad_accounts where client_id = '${d.cliente}'`);
    query(`delete from core.clients where id = '${d.cliente}'`);
    assert.equal(query(`select count(*) from core.client_brain_catalog_state where client_id = '${d.cliente}'`), '0');
    assert.equal(query(`select count(*) from core.client_brain_coverage where client_id = '${d.cliente}'`), '0');
  });

  it('a varredura lista o cliente com coleta nova e esconde o excluído', () => {
    const d = semear();
    const listados = query(`select string_agg(client_id::text, ',') from core.brain_clientes_para_publicar(500)`);
    assert.ok(listados.includes(d.cliente));
    query(`update core.clients set excluido_em = now(), excluido_por = 'teste brain' where id = '${d.cliente}'`);
    const depois = query(`select coalesce(string_agg(client_id::text, ','), '') from core.brain_clientes_para_publicar(500)`);
    assert.ok(!depois.includes(d.cliente));
    assert.equal(query(`select count(*) from core.brain_resolver_cliente('${d.cliente}')`), '0');
  });
});
