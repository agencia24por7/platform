import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, workerHeaders } from './helpers.mjs';
import { PG_CONTAINER } from './apoio/pgContainer.mjs';

const sufixo = randomBytes(4).toString('hex');
const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], { encoding: 'utf8' })
    .trim()
    .split('\n')[0]
    .trim();

const leitura = (cliente) => `${BASE}/api/v0/brain/clientes/${cliente}/regras`;
const escrita = (cliente) => `${BASE}/api/v0/regras/clientes/${cliente}/decisoes`;
const ler = (cliente, cabecalhos = {}) => fetch(leitura(cliente), { headers: { ...workerHeaders(), ...cabecalhos } });
const registrar = (cliente, corpo, cabecalhos = {}) =>
  fetch(escrita(cliente), { method: 'POST', headers: { ...workerHeaders(), ...cabecalhos }, body: JSON.stringify(corpo) });

let sequencia = 0;
const decisaoDeProcesso = (extra = {}) => ({
  agenteId: 'agente-teste',
  execucaoId: `exec-${sufixo}-${sequencia}`,
  idempotencyKey: `chave-${sufixo}-${++sequencia}`,
  categoria: 'processo',
  natureza: 'decisao',
  titulo: 'Pausar campanhas no fim de semana',
  contexto: 'Pedido do anunciante por telefone.',
  ...extra,
});

const organizacao = (nome) =>
  dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Agentes ${nome} ${sufixo}', 'agentes-${nome}-${sufixo}', 'agency') RETURNING id`);
const cliente = (org, nome) =>
  dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome} ${sufixo}', 'leads') RETURNING id`);
const contagem = (cli) => Number(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}'`));

describe('regras do cliente para agentes (ADR 0051 §10)', { concurrency: false }, () => {
  const ids = {};

  before(async () => {
    assert.ok(await appIsUp(), 'App não está no ar');
    ids.orgA = organizacao('a');
    ids.orgB = organizacao('b');
    ids.a1 = cliente(ids.orgA, 'a1');
    ids.a2 = cliente(ids.orgA, 'a2');
    ids.a3 = cliente(ids.orgA, 'a3');
    ids.b1 = cliente(ids.orgB, 'b1');
  });

  it('sem bearer do worker, leitura e escrita respondem 401', async () => {
    const lida = await fetch(leitura(ids.a1));
    const escrita401 = await fetch(escrita(ids.a1), { method: 'POST', body: JSON.stringify(decisaoDeProcesso()) });
    const errada = await fetch(leitura(ids.a1), { headers: { Authorization: 'Bearer errado' } });
    assert.equal(lida.status, 401);
    assert.equal(escrita401.status, 401);
    assert.equal(errada.status, 401);
    assert.equal(contagem(ids.a1), 0);
  });

  it('leitura devolve ETag, hash do conjunto, marca de conteúdo não confiável e 304 com If-None-Match', async () => {
    const resposta = await ler(ids.a1);
    assert.equal(resposta.status, 200);
    const etag = resposta.headers.get('etag');
    assert.match(etag, /^"[0-9a-f]{32}"$/);
    assert.ok(resposta.headers.get('x-request-id'));
    const corpo = await resposta.json();
    assert.equal(corpo.clienteId, ids.a1);
    assert.equal(corpo.conteudoNaoConfiavel, true);
    assert.match(corpo.hashDoConjunto, /^[0-9a-f]{64}$/);
    assert.deepEqual(corpo.vigentes, []);

    const condicional = await ler(ids.a1, { 'If-None-Match': etag });
    assert.equal(condicional.status, 304);
    assert.equal(condicional.headers.get('etag'), etag);
    const fraco = await ler(ids.a1, { 'If-None-Match': `W/${etag}` });
    assert.equal(fraco.status, 304);
  });

  it('cliente inexistente, malformado ou sem rota devolve 404 igual, sem vazar existência', async () => {
    const inexistente = await ler('99999999-9999-4999-8999-999999999999');
    const malformado = await ler('nao-e-uuid');
    assert.equal(inexistente.status, 404);
    assert.equal(malformado.status, 404);
    assert.equal((await inexistente.json()).title, (await malformado.json()).title);
    const escritaInexistente = await registrar('99999999-9999-4999-8999-999999999999', decisaoDeProcesso());
    assert.equal(escritaInexistente.status, 404);
  });

  it('agente registra decisão de processo: nasce vigente, origem agente, e muda o ETag', async () => {
    const antes = (await ler(ids.a1)).headers.get('etag');
    const resposta = await registrar(ids.a1, decisaoDeProcesso(), { 'x-request-id': `req-${sufixo}` });
    assert.equal(resposta.status, 201);
    assert.equal(resposta.headers.get('x-request-id'), `req-${sufixo}`);
    const corpo = await resposta.json();
    assert.equal(corpo.repetida, false);
    assert.equal(corpo.clienteId, ids.a1);
    assert.equal(corpo.decisao.origem, 'agente');
    assert.equal(corpo.decisao.status, 'vigente');
    assert.equal(corpo.decisao.natureza, 'decisao');
    assert.equal(corpo.decisao.conteudoNaoConfiavel, true);
    assert.equal(corpo.decisao.numero, 1);

    const depois = await ler(ids.a1);
    assert.notEqual(depois.headers.get('etag'), antes);
    const lido = await depois.json();
    assert.deepEqual(lido.vigentes.map((v) => v.numero), [1]);
    assert.equal(lido.vigentes[0].titulo, 'Pausar campanhas no fim de semana');
    assert.equal(lido.vigentes[0].conteudoNaoConfiavel, true);
    assert.equal(dono(`SELECT request_id FROM core.client_decision_events WHERE client_id = '${ids.a1}' ORDER BY occurred_at LIMIT 1`), `req-${sufixo}`);
  });

  it('agente que registra limite ou regra gera apenas proposta, nunca vigente', async () => {
    const limite = await registrar(
      ids.a1,
      decisaoDeProcesso({
        categoria: 'investimento',
        natureza: 'limite',
        chave: 'investimento.teto_mensal',
        titulo: 'Teto mensal',
        valor: { unidade: 'brl_centavos', centavos: '500000', moeda: 'BRL' },
      }),
    );
    assert.equal(limite.status, 201);
    const corpoLimite = await limite.json();
    assert.equal(corpoLimite.decisao.status, 'proposta');
    assert.equal(corpoLimite.decisao.origem, 'agente');

    const regra = await registrar(
      ids.a1,
      decisaoDeProcesso({ categoria: 'processo', natureza: 'regra', chave: 'processo.horario', titulo: 'Horário', texto: 'Não publicar após 22h.' }),
    );
    assert.equal(regra.status, 201);
    assert.equal((await regra.json()).decisao.status, 'proposta');

    const vigentes = (await (await ler(ids.a1)).json()).vigentes;
    assert.ok(vigentes.every((v) => v.natureza === 'decisao'));
    assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${ids.a1}' AND status = 'vigente' AND nature <> 'decisao'`), '0');
  });

  it('limite vigente por pessoa aparece na leitura com a definição de limite relevante', async () => {
    const id = dono(
      `INSERT INTO core.client_decisions (organization_id, client_id, category, nature, origin, status, key, scope, title, value, definition_key, definition_version)
       VALUES ('${ids.orgA}', '${ids.a2}', 'investimento', 'limite', 'agencia', 'vigente', 'investimento.teto_mensal', 'cliente', 'Teto', '{"valor":"900000","unidade":"brl_centavos"}'::jsonb, 'investimento.teto_mensal', 1) RETURNING id`,
    );
    assert.ok(id);
    const corpo = await (await ler(ids.a2)).json();
    assert.equal(corpo.vigentes.length, 1);
    assert.equal(corpo.vigentes[0].natureza, 'limite');
    assert.equal(corpo.vigentes[0].origem, 'agencia');
    assert.deepEqual(corpo.definicoesDeLimite.map((d) => d.key), ['investimento.teto_mensal']);
  });

  it('corpo com origem, status ou campos fora do contrato é 422 e nada é gravado', async () => {
    const antes = contagem(ids.a3);
    for (const extra of [{ origem: 'agencia' }, { origem: 'agente' }, { status: 'vigente' }, { organizationId: ids.orgB }, { clienteId: ids.b1 }]) {
      const resposta = await registrar(ids.a3, decisaoDeProcesso(extra));
      assert.equal(resposta.status, 422, JSON.stringify(extra));
    }
    assert.equal(contagem(ids.a3), antes);
  });

  it('sem chave de idempotência, agente ou execução o corpo é 422', async () => {
    for (const campo of ['idempotencyKey', 'agenteId', 'execucaoId']) {
      const corpo = decisaoDeProcesso();
      delete corpo[campo];
      const resposta = await registrar(ids.a3, corpo);
      assert.equal(resposta.status, 422, campo);
    }
    const so = await fetch(escrita(ids.a3), { method: 'POST', headers: { ...workerHeaders(), 'Idempotency-Key': 'so-no-cabecalho' }, body: JSON.stringify((({ idempotencyKey, ...resto }) => resto)(decisaoDeProcesso())) });
    assert.equal(so.status, 422);
    const invalido = await fetch(escrita(ids.a3), { method: 'POST', headers: workerHeaders(), body: '{nao-json' });
    assert.equal(invalido.status, 422);
    assert.equal(contagem(ids.a3), 0);
  });

  it('idempotência: repetir a chave devolve 200 com repetida:true, a mesma decisão e sem duplicar', async () => {
    const corpo = decisaoDeProcesso();
    const primeira = await registrar(ids.a3, corpo);
    assert.equal(primeira.status, 201);
    const criada = await primeira.json();
    const segunda = await registrar(ids.a3, corpo);
    assert.equal(segunda.status, 200);
    const repetida = await segunda.json();
    assert.equal(repetida.repetida, true);
    assert.equal(repetida.decisao.id, criada.decisao.id);
    assert.equal(contagem(ids.a3), 1);
    const paralelas = await Promise.all([registrar(ids.a3, decisaoDeProcesso({ idempotencyKey: `par-${sufixo}` })), registrar(ids.a3, decisaoDeProcesso({ idempotencyKey: `par-${sufixo}` }))]);
    assert.deepEqual(paralelas.map((r) => r.status).sort(), [200, 201]);
    assert.equal(contagem(ids.a3), 2);
  });

  it('agente de um cliente não escreve em outro: a URL manda e a decisão fica só no cliente da URL', async () => {
    const chave = `isolamento-${sufixo}`;
    const emA = await registrar(ids.a1, decisaoDeProcesso({ idempotencyKey: chave, titulo: 'Só do A1' }));
    const emB = await registrar(ids.b1, decisaoDeProcesso({ idempotencyKey: chave, titulo: 'Só do B1' }));
    assert.equal(emA.status, 201);
    assert.equal(emB.status, 201);
    assert.equal((await emB.json()).repetida, false);
    assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${ids.b1}'`), '1');
    assert.equal(dono(`SELECT organization_id FROM core.client_decisions WHERE client_id = '${ids.b1}'`), ids.orgB);
    const doB = await (await ler(ids.b1)).json();
    assert.deepEqual(doB.vigentes.map((v) => v.titulo), ['Só do B1']);
    const doA = await (await ler(ids.a1)).json();
    assert.ok(!doA.vigentes.some((v) => v.titulo === 'Só do B1'));
    assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${ids.a1}' AND title = 'Só do B1'`), '0');
  });

  it('teto por execução: a decisão seguinte ao teto é 429 e nada é gravado', async () => {
    const alvo = cliente(ids.orgA, 'teto');
    const execucaoId = `exec-teto-${sufixo}`;
    dono(
      `INSERT INTO core.client_decisions (organization_id, client_id, category, nature, origin, status, title, agent_id, agent_run_id, idempotency_key)
       SELECT '${ids.orgA}', '${alvo}', 'processo', 'decisao', 'agente', 'vigente', 'Semeada ' || n, 'agente-teste', '${execucaoId}', 'semeada-${sufixo}-' || n
       FROM generate_series(1, 49) AS n`,
    );
    const ultima = await registrar(alvo, decisaoDeProcesso({ execucaoId, titulo: 'Quinquagésima' }));
    assert.equal(ultima.status, 201);
    const excedida = await registrar(alvo, decisaoDeProcesso({ execucaoId, titulo: 'Excedente' }));
    assert.equal(excedida.status, 429);
    assert.equal(contagem(alvo), 50);
    const outraExecucao = await registrar(alvo, decisaoDeProcesso({ execucaoId: `${execucaoId}-outra` }));
    assert.equal(outraExecucao.status, 201);
  });

  it('teto por execução sob concorrência: requisições paralelas na mesma execução não passam do teto', async () => {
    const alvo = cliente(ids.orgA, 'teto-paralelo');
    const execucaoId = `exec-paralela-${sufixo}`;
    dono(
      `INSERT INTO core.client_decisions (organization_id, client_id, category, nature, origin, status, title, agent_id, agent_run_id, idempotency_key)
       SELECT '${ids.orgA}', '${alvo}', 'processo', 'decisao', 'agente', 'vigente', 'Semeada ' || n, 'agente-teste', '${execucaoId}', 'paralela-${sufixo}-' || n
       FROM generate_series(1, 47) AS n`,
    );
    const respostas = await Promise.all(
      Array.from({ length: 6 }, (_, i) => registrar(alvo, decisaoDeProcesso({ execucaoId, titulo: `Paralela ${i}` }))),
    );
    const status = respostas.map((r) => r.status);
    assert.equal(status.filter((s) => s === 201).length, 3, JSON.stringify(status));
    assert.equal(status.filter((s) => s === 429).length, 3, JSON.stringify(status));
    assert.equal(contagem(alvo), 50);
  });

  it('o que o agente lê passa pelo textoSeguro: e-mail e telefone não saem na leitura', async () => {
    const alvo = cliente(ids.orgA, 'pii');
    const criada = await registrar(
      alvo,
      decisaoDeProcesso({ titulo: 'Avisar maria@exemplo.com', contexto: 'Ligar (11) 98765-4321', texto: 'CPF 123.456.789-00' }),
    );
    assert.equal(criada.status, 201);
    const corpoDaCriacao = JSON.stringify(await criada.json());
    const lida = JSON.stringify(await (await ler(alvo)).json());
    for (const texto of [corpoDaCriacao, lida]) {
      for (const proibido of ['maria@exemplo.com', '98765-4321', '123.456.789-00']) assert.ok(!texto.includes(proibido), proibido);
    }
    assert.match(lida, /\[omitido\]/);
  });
});
