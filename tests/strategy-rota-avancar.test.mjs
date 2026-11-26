import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { BASE, appIsUp, workerHeaders } from './helpers.mjs';
import { PG_CONTAINER } from './apoio/pgContainer.mjs';

const sufixo = randomBytes(4).toString('hex');
const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], { encoding: 'utf8' })
    .trim()
    .split('\n')[0]
    .trim();

const ROTA = `${BASE}/api/v0/strategy/execucoes/avancar`;
const avancar = (corpo, cabecalhos = workerHeaders()) =>
  fetch(ROTA, { method: 'POST', headers: cabecalhos, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });

const OBJETIVO_SECRETO = `Objetivo sigiloso ${sufixo}`;
const INTENCAO = JSON.stringify({
  objetivo: OBJETIVO_SECRETO,
  horizonte: { inicio: '2026-12-01', fim: '2027-02-28' },
  ousadia: 'moderado',
  retorno_esperado: { descricao: 'Custo por lead abaixo da meta' },
  verba: { centavos: '1000000', moeda: 'BRL' },
});

describe('rota de worker POST /api/v0/strategy/execucoes/avancar (ADR 0062 §9)', { concurrency: false }, () => {
  const ids = {};

  before(async () => {
    assert.ok(await appIsUp(), 'App não está no ar');
    ids.org = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Rota ${sufixo}', 'rota-${sufixo}', 'agency') RETURNING id`);
    ids.cli = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${ids.org}', 'rota ${sufixo}', 'leads') RETURNING id`);
    ids.plano = dono(`INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key) VALUES ('${ids.org}', '${ids.cli}', 'rota') RETURNING id`);
    ids.run = `run-rota-${sufixo}`;
    ids.execucao = dono(
      `INSERT INTO core.strategy_plan_runs (organization_id, client_id, plan_id, kind, pedido, agent_run_id, requested_kind)
       VALUES ('${ids.org}', '${ids.cli}', '${ids.plano}', 'criar', '${INTENCAO}'::jsonb, '${ids.run}', 'sistema') RETURNING id`,
    );
  });

  after(() => {
    dono(`DELETE FROM core.clients WHERE id = '${ids.cli}'`);
    dono(`DELETE FROM core.organizations WHERE id = '${ids.org}'`);
  });

  it('sem bearer, com bearer errado ou sem Authorization responde 401 e não toca na fila', async () => {
    const sem = await avancar({}, { 'Content-Type': 'application/json' });
    const errado = await avancar({}, { Authorization: 'Bearer token-errado', 'Content-Type': 'application/json' });
    const outroEsquema = await avancar({}, { Authorization: 'Basic abc', 'Content-Type': 'application/json' });
    assert.deepEqual([sem.status, errado.status, outroEsquema.status], [401, 401, 401]);
    assert.equal(dono(`SELECT status || '/' || tentativas FROM core.strategy_plan_runs WHERE id = '${ids.execucao}'`), 'pendente/0');
  });

  it('corpo inválido responde 4xx de validação: JSON quebrado, limite acima de 50, abaixo de 1, não inteiro, chave desconhecida', async () => {
    const casos = {
      'json quebrado': '{nao-json',
      'limite 51': { limite: 51 },
      'limite 1000': { limite: 1000 },
      'limite 0': { limite: 0 },
      'limite negativo': { limite: -1 },
      'limite fracionário': { limite: 1.5 },
      'limite texto': { limite: '10' },
      'chave desconhecida': { limite: 1, organizationId: ids.org },
    };
    for (const [nome, corpo] of Object.entries(casos)) {
      const resposta = await avancar(corpo);
      assert.ok([400, 422].includes(resposta.status), `${nome}: ${resposta.status}`);
      const texto = await resposta.text();
      assert.ok(!texto.includes(OBJETIVO_SECRETO), nome);
    }
    assert.equal(dono(`SELECT status || '/' || tentativas FROM core.strategy_plan_runs WHERE id = '${ids.execucao}'`), 'pendente/0', 'corpo inválido não processa nada');
  });

  it('200 devolve só contagens e códigos, nenhum conteúdo, e o limite 50 vale', async () => {
    const resposta = await avancar({ limite: 50 });
    assert.equal(resposta.status, 200);
    const texto = await resposta.text();
    const corpo = JSON.parse(texto);
    assert.deepEqual(Object.keys(corpo).sort(), ['adiadas', 'avancadas', 'codigos', 'concluidas', 'encontradas', 'falhas', 'perdidas', 'reservadas']);
    for (const [chave, valor] of Object.entries(corpo)) {
      if (chave === 'codigos') {
        for (const [codigo, quantidade] of Object.entries(valor)) {
          assert.match(codigo, /^(ia_[a-z_]+|brain_indisponivel|gate_reprovado|interno)$/);
          assert.equal(Number.isInteger(quantidade), true);
        }
      } else {
        assert.equal(Number.isInteger(valor) && valor >= 0, true, chave);
      }
    }
    assert.ok(corpo.encontradas >= 1 && corpo.reservadas >= 1, texto);
    for (const proibido of [OBJETIVO_SECRETO, ids.run, ids.execucao, ids.plano, ids.cli, ids.org, 'objetivo', 'pedido']) {
      assert.ok(!texto.includes(proibido), `a resposta não pode conter ${proibido}`);
    }
    assert.ok(Number(dono(`SELECT tentativas FROM core.strategy_plan_runs WHERE id = '${ids.execucao}'`)) >= 1, 'a execução foi reservada');
  });

  it('sem corpo usa o limite padrão e também responde só contagens', async () => {
    const resposta = await avancar('{}');
    assert.equal(resposta.status, 200);
    const corpo = await resposta.json();
    assert.equal(typeof corpo.encontradas, 'number');
    assert.equal(typeof corpo.codigos, 'object');
  });
});
