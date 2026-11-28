import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { BASE, appIsUp, browse, signIn, submitAction, workerHeaders } from './helpers.mjs';
import { PG_CONTAINER } from './apoio/pgContainer.mjs';
import { aspas, criarSemeadorDeEstrategia, dono } from './apoio/semearEstrategia.mjs';

const sufixo = randomBytes(4).toString('hex');

const disponibilidade = await (async () => {
  try {
    const existe = dono("SELECT to_regclass('core.strategy_production_plans') IS NOT NULL");
    if (existe !== 't') return `container ${PG_CONTAINER} sem a migração 0154 aplicada`;
  } catch (falha) {
    return `Postgres do container ${PG_CONTAINER} indisponível (${String(falha.message).split('\n')[0]})`;
  }
  return (await appIsUp()) ? null : 'App fora do ar';
})();

if (disponibilidade && process.env.CI) {
  describe('Plano de produção: página, ação, download e rota do worker', () => {
    it('o app e o Postgres do harness precisam estar disponíveis no CI', () => {
      assert.fail(disponibilidade);
    });
  });
}

const pular = disponibilidade && !process.env.CI ? disponibilidade : disponibilidade ? true : false;
const fixtures = pular ? null : await import('../src/modules/strategy/domain/fixturesDeTeste.ts');
const daProducao = pular ? null : await import('../src/modules/strategy/domain/producao/fixturesDaProducao.ts');

const trocarIds = (valor, organizacao, cliente) =>
  JSON.parse(JSON.stringify(valor).replaceAll(fixtures.ORGANIZACAO_ID, organizacao).replaceAll(fixtures.CLIENTE_ID, cliente));

describe('Plano de produção: página, ação, download e rota do worker (ADR 0074)', { concurrency: false, skip: pular }, () => {
  const ids = {};
  const criadas = { orgs: [], clientes: [], usuarios: [] };
  const org = (nome) => {
    const id = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Prod pag ${nome} ${sufixo}', 'prod-pag-${nome}-${sufixo}', 'agency') RETURNING id`);
    criadas.orgs.push(id);
    return id;
  };
  const cliente = (organizacao, nome) => {
    const id = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${organizacao}', '${nome} ${sufixo}', 'leads') RETURNING id`);
    criadas.clientes.push(id);
    return id;
  };
  const membro = (organizacao, papel) => {
    const id = dono(`INSERT INTO core.users (email, name) VALUES ('prod-pag-${papel}-${randomBytes(3).toString('hex')}-${sufixo}@tria.local', '${papel}') RETURNING id`);
    criadas.usuarios.push(id);
    dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${organizacao}', '${id}', '${papel}') RETURNING id`);
    return id;
  };
  const rota = (cli, plano, resto = '') => `/clientes/${cli}/estrategia/${plano}/producao${resto}`;
  const destinoDe = (resposta) => decodeURIComponent(resposta.location ?? resposta.redirectedTo ?? '');
  const semScripts = (texto) => texto.replace(/<script[\s\S]*?<\/script>/g, '').replaceAll('<!-- -->', '');
  async function pagina(caminho) {
    const resposta = await browse(caminho);
    return { status: resposta.status, texto: semScripts(await resposta.text()), location: resposta.headers.get('location') };
  }
  function acaoDoBotao(texto, rotulo) {
    for (const formulario of texto.split('<form').slice(1).map((pedaco) => pedaco.slice(0, pedaco.indexOf('</form>')))) {
      if (!formulario.includes(rotulo)) continue;
      const id = formulario.match(/name="\$ACTION_ID_([a-f0-9]+)"/)?.[1];
      if (id) return id;
    }
    throw new Error(`Nenhuma server action para o botão "${rotulo}".`);
  }
  const linhas = (plano) => dono(`SELECT count(*) FROM core.strategy_production_plans WHERE plan_id = '${plano}'`);

  before(() => {
    ids.org = org('a');
    ids.orgOutra = org('b');
    ids.dono = membro(ids.org, 'owner');
    ids.operador = membro(ids.org, 'operator');
    ids.leitor = membro(ids.org, 'viewer');
    ids.alheio = membro(ids.orgOutra, 'owner');
    ids.cli = cliente(ids.org, 'Doceria Exemplo');
    ids.cliPronto = cliente(ids.org, 'Padaria Exemplo');
    const semear = criarSemeadorDeEstrategia({ org: ids.org, operador: ids.operador });

    ids.plano = semear.planoNovo(ids.cli);
    ids.versao = semear.versaoRascunho(ids.cli, ids.plano, trocarIds(fixtures.planoCompletoBruto(), ids.org, ids.cli));
    dono(`SET session_replication_role = replica; UPDATE core.strategy_plan_versions SET status = 'vigente' WHERE id = '${ids.versao}' RETURNING id`);

    ids.planoPronto = semear.planoNovo(ids.cliPronto);
    ids.versaoPronto = semear.versaoRascunho(ids.cliPronto, ids.planoPronto, trocarIds(fixtures.planoCompletoBruto(), ids.org, ids.cliPronto));
    dono(`SET session_replication_role = replica; UPDATE core.strategy_plan_versions SET status = 'vigente' WHERE id = '${ids.versaoPronto}' RETURNING id`);
    const busca = daProducao.producaoDaBusca();
    busca.conceito = '<script>alert(1)</script> # injetado [link](javascript:x)';
    const conteudo = trocarIds(
      {
        schema_version: 1,
        janela: daProducao.JANELA_DE_TESTE,
        campanhas: [busca, daProducao.producaoDoSocial()],
        referencias: [{ urn: daProducao.URN_REFERENCIA, hash: 'a'.repeat(64), tipo: 'culture_referencia', titulo: 'Campanha de referência do setor' }],
      },
      ids.org,
      ids.cliPronto,
    );
    ids.producaoPronta = dono(
      `SET session_replication_role = replica;
       INSERT INTO core.strategy_production_plans (organization_id, client_id, plan_id, version_id, numero, status, conteudo, agent_run_id, concluido_em)
       VALUES ('${ids.org}', '${ids.cliPronto}', '${ids.planoPronto}', '${ids.versaoPronto}', 1, 'pronto', ${aspas(JSON.stringify(conteudo))}::jsonb, 'producao-pag-${sufixo}', now()) RETURNING id`,
    );
  });

  after(() => {
    const tentar = (sql) => {
      try {
        dono(sql);
      } catch {
        return;
      }
    };
    for (const id of criadas.clientes) tentar(`DELETE FROM core.clients WHERE id = '${id}'`);
    for (const id of criadas.usuarios) tentar(`DELETE FROM core.members WHERE user_id = '${id}'`);
    for (const id of criadas.usuarios) tentar(`DELETE FROM core.users WHERE id = '${id}'`);
    for (const id of criadas.orgs) tentar(`DELETE FROM core.organizations WHERE id = '${id}'`);
  });

  it('operator vê a página com o botão de gerar; viewer é mandado para Conexões; outra organização não encontra', async () => {
    signIn(ids.operador);
    const vista = await pagina(rota(ids.cli, ids.plano));
    assert.equal(vista.status, 200);
    assert.match(vista.texto, /Plano de produção/);
    assert.match(vista.texto, /Nenhum plano de produção ainda/);
    assert.ok(acaoDoBotao(vista.texto, 'Gerar plano de produção'));

    signIn(ids.leitor);
    const leitor = await browse(rota(ids.cli, ids.plano));
    assert.ok([303, 307, 308].includes(leitor.status), `status ${leitor.status}`);
    assert.match(leitor.headers.get('location') ?? '', /conexoes/);

    signIn(ids.alheio);
    const alheio = await pagina(rota(ids.cli, ids.plano));
    assert.equal(alheio.status, 404);
  });

  it('a server action recusa viewer e pede para operator; o pedido fica pendente e a página mostra a geração', async () => {
    signIn(ids.operador);
    const acao = acaoDoBotao((await pagina(rota(ids.cli, ids.plano))).texto, 'Gerar plano de produção');

    signIn(ids.leitor);
    const negada = await submitAction(rota(ids.cli, ids.plano), acao, { clienteId: ids.cli, planoId: ids.plano });
    assert.match(destinoDe(negada), /erro=/);
    assert.equal(linhas(ids.plano), '0');

    signIn(ids.alheio);
    const alheio = await submitAction(rota(ids.cli, ids.plano), acao, { clienteId: ids.cli, planoId: ids.plano });
    assert.ok(!/feito=/.test(destinoDe(alheio)));
    assert.equal(linhas(ids.plano), '0');

    signIn(ids.operador);
    const feita = await submitAction(rota(ids.cli, ids.plano), acao, { clienteId: ids.cli, planoId: ids.plano });
    assert.match(destinoDe(feita), /feito=Plano de produção pedido/);
    assert.equal(dono(`SELECT status FROM core.strategy_production_plans WHERE plan_id = '${ids.plano}'`), 'pendente');
    const depois = await pagina(rota(ids.cli, ids.plano));
    assert.match(depois.texto, /Gerando o plano de produção/);
    assert.match(depois.texto, /Aguarde a geração em andamento terminar/);

    const repetida = await submitAction(rota(ids.cli, ids.plano), acao, { clienteId: ids.cli, planoId: ids.plano });
    assert.match(destinoDe(repetida), /erro=/);
    assert.equal(linhas(ids.plano), '1');
  });

  it('a rota do worker exige o token e, sem modelo configurado, encerra a geração com motivo da lista', async () => {
    const sem = await fetch(`${BASE}/api/v0/strategy/producao/avancar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(sem.status, 401);
    const resposta = await fetch(`${BASE}/api/v0/strategy/producao/avancar`, { method: 'POST', headers: workerHeaders(), body: JSON.stringify({ limite: 20 }) });
    assert.equal(resposta.status, 200);
    const corpo = await resposta.json();
    assert.deepEqual(Object.keys(corpo).sort(), ['adiadas', 'chamadas', 'codigos', 'encontradas', 'falhas', 'perdidas', 'prontas', 'reservadas']);
    const final = dono(`SELECT status || ':' || coalesce(erro_codigo, '') FROM core.strategy_production_plans WHERE plan_id = '${ids.plano}'`);
    assert.equal(final, 'falhou:ia_nao_configurada');
    signIn(ids.operador);
    const vista = await pagina(rota(ids.cli, ids.plano));
    assert.match(vista.texto, /A geração falhou/);
    assert.match(vista.texto, /Nenhum modelo de IA/);
  });

  it('plano de produção pronto aparece por campanha e o download em Markdown escapa o texto', async () => {
    signIn(ids.operador);
    const vista = await pagina(rota(ids.cliPronto, ids.planoPronto));
    assert.equal(vista.status, 200);
    assert.match(vista.texto, /Busca de fundo de funil/);
    assert.match(vista.texto, /Anúncio responsivo principal/);
    assert.match(vista.texto, /Campanha de referência do setor/);
    assert.ok(!vista.texto.includes('<script>alert(1)</script>'));

    const caminho = rota(ids.cliPronto, ids.planoPronto, `/download?geracao=${ids.producaoPronta}`);
    const download = await browse(caminho);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-type') ?? '', /text\/markdown/);
    assert.match(download.headers.get('content-disposition') ?? '', /attachment; filename="plano-de-producao-/);
    const texto = await download.text();
    assert.ok(!texto.includes('<script>'));
    assert.ok(!/^# injetado/m.test(texto));
    assert.match(texto, /## Busca de fundo de funil/);

    signIn(ids.leitor);
    assert.equal((await browse(caminho)).status, 403);
    signIn(ids.alheio);
    assert.equal((await browse(caminho)).status, 404);
    signIn(ids.operador);
    assert.equal((await browse(rota(ids.cli, ids.plano, `/download?geracao=${ids.producaoPronta}`))).status, 404);
  });
});
