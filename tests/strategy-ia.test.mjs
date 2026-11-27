import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, browse, ensureUser, makeOwner, post, signIn, signOut, submitAction, workerHeaders } from './helpers.mjs';
import { psqlDonoPrimeiraLinha as query } from './apoio/psql.mjs';

const sufixo = () => randomUUID().slice(0, 8);
const chaveDeTeste = () => `orla-teste:${randomUUID()}${randomUUID()}`;
const PAGINA = '/config/ia';
const TAREFAS = ['strategy_plan', 'comite', 'juiz', 'gate'];
const INTENCAO = JSON.stringify({
  objetivo: 'Gerar leads qualificados',
  horizonte: { inicio: '2026-12-01', fim: '2027-02-28' },
  ousadia: 'moderado',
  retorno_esperado: { descricao: 'Custo por lead abaixo da meta' },
  verba: { centavos: '1000000', moeda: 'BRL' },
  plataformas: ['meta'],
  destino: { landingPageId: 'lp_principal', url: 'https://exemplo.com.br/oferta' },
  utm: { meta: { utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'aquisicao-leads-do-trimestre-202612' } },
});

const ligado = await appIsUp();
const pular = !ligado && !process.env.CI ? 'app fora do ar' : false;

function organizacao(rotulo) {
  const s = sufixo();
  const org = query(`insert into core.organizations (name, slug, type) values ('Agência ${rotulo} ${s}', 'sia-${rotulo}-${s}', 'agency') returning id`);
  const cliente = query(`insert into core.clients (organization_id, name, business_model) values ('${org}', 'Cliente ${rotulo} ${s}', 'leads') returning id`);
  const dono = ensureUser(`sia-dono-${s}@tria.local`);
  makeOwner(dono, org);
  const plano = query(`insert into core.strategy_plans (organization_id, client_id, plan_type_key) values ('${org}', '${cliente}', 'aquisicao') returning id`);
  const execucao = query(
    `insert into core.strategy_plan_runs (organization_id, client_id, plan_id, kind, pedido, agent_run_id, requested_kind)
     values ('${org}', '${cliente}', '${plano}', 'criar', '${INTENCAO}'::jsonb, 'run-sia-${s}', 'sistema') returning id`,
  );
  return { org, cliente, dono, plano, execucao };
}

async function acaoDoBotao(texto) {
  const html = await (await browse(PAGINA)).text();
  const formulario = html.split('<form').slice(1).map((p) => p.slice(0, p.indexOf('</form>'))).find((f) => f.includes(texto));
  assert.ok(formulario, `formulário com o botão "${texto}"`);
  const id = formulario.match(/name="\$ACTION_ID_([a-f0-9]+)"/)?.[1];
  assert.ok(id, `ação de "${texto}"`);
  return id;
}

async function configurarIa(o, { chamadasPorDia } = {}) {
  signIn(o.dono);
  await submitAction(PAGINA, await acaoDoBotao('Testar e guardar'), { fornecedor: 'google', chave: chaveDeTeste() });
  const salvar = await acaoDoBotao('Salvar</button>');
  for (const tarefa of TAREFAS) await submitAction(PAGINA, salvar, { tarefa, escolha: 'google|modelo-de-teste-a' });
  if (chamadasPorDia) await submitAction(PAGINA, await acaoDoBotao('Salvar tetos'), { chamadasPorDia: String(chamadasPorDia), tokensPorDia: '2000000' });
  signOut();
}

async function ate(o) {
  for (let i = 0; i < 12; i += 1) {
    const resposta = await post('/api/v0/strategy/execucoes/avancar', { limite: 50 });
    assert.equal(resposta.status, 200);
    const estado = query(`select status from core.strategy_plan_runs where id = '${o.execucao}'`);
    if (['concluida', 'falhou', 'cancelada'].includes(estado)) return estado;
  }
  throw new Error('a execução não terminou');
}

const execucao = (o) => query(`select status || '|' || coalesce(erro_codigo, '') from core.strategy_plan_runs where id = '${o.execucao}'`);
const versoes = (o) => Number(query(`select count(*) from core.strategy_plan_versions where plan_id = '${o.plano}'`));
const usos = (o, filtro = 'true') => Number(query(`select count(*) from core.ai_usage where organization_id = '${o.org}' and ${filtro}`));

describe('Estratégia sobre a camada de IA (worker, chave e modelo por tarefa, uso e teto)', { concurrency: false, skip: pular }, () => {
  before(() => assert.ok(ligado, 'App não está no ar'));

  it('com chave e modelo: a chamada chega ao executor pelo worker e registra uso; saída fora do esquema falha com o código certo e nada inválido é gravado', async () => {
    const o = organizacao('a');
    await configurarIa(o);
    assert.equal(query(`select count(*) from core.ai_task_models where organization_id = '${o.org}'`), String(TAREFAS.length));
    assert.equal(await ate(o), 'falhou');
    assert.equal(execucao(o), 'falhou|ia_saida_invalida');
    assert.equal(versoes(o), 0);
    assert.equal(query(`select count(*) from core.strategy_plan_events where client_id = '${o.cliente}'`), '0');
    assert.ok(usos(o, `task = 'strategy_plan' and provider = 'google' and model = 'modelo-de-teste-a'`) >= 1);
    assert.equal(usos(o, `task <> 'strategy_plan'`), 0);
    assert.equal(usos(o, `result = 'reservada'`), 0, 'toda reserva foi concluída');
    assert.equal(usos(o), 3, 'uma chamada por tentativa (a primeira e duas repetições da etapa): sem idempotência, cada tentativa gasta cota');
  });

  it('sem chave nem modelo: falha com ia_nao_configurada e nenhum uso', async () => {
    const o = organizacao('b');
    assert.equal(await ate(o), 'falhou');
    assert.equal(execucao(o), 'falhou|ia_nao_configurada');
    assert.equal(usos(o), 0);
    assert.equal(versoes(o), 0);
  });

  it('chave sem modelo escolhido para a tarefa: ia_nao_configurada', async () => {
    const o = organizacao('c');
    signIn(o.dono);
    await submitAction(PAGINA, await acaoDoBotao('Testar e guardar'), { fornecedor: 'google', chave: chaveDeTeste() });
    signOut();
    assert.equal(await ate(o), 'falhou');
    assert.equal(execucao(o), 'falhou|ia_nao_configurada');
  });

  it('IA desligada: ia_limite e nenhuma linha de uso', async () => {
    const o = organizacao('d');
    await configurarIa(o);
    signIn(o.dono);
    await submitAction(PAGINA, await acaoDoBotao('Desligar a IA da organização'), { ligada: 'nao' });
    signOut();
    assert.equal(await ate(o), 'falhou');
    assert.equal(execucao(o), 'falhou|ia_limite');
    assert.equal(usos(o), 0);
  });

  it('teto diário de chamadas estourado: ia_limite, e o uso não passa do teto', async () => {
    const o = organizacao('e');
    await configurarIa(o, { chamadasPorDia: 1 });
    assert.equal(await ate(o), 'falhou');
    assert.equal(execucao(o), 'falhou|ia_limite');
    assert.equal(usos(o), 1);
    assert.equal(versoes(o), 0);
  });

  it('a resposta da rota do worker tem formato fechado: só contagens inteiras e códigos de um conjunto fechado', async () => {
    const resposta = await fetch(`${BASE}/api/v0/strategy/execucoes/avancar`, { method: 'POST', headers: workerHeaders(), body: '{}' });
    assert.equal(resposta.status, 200);
    const corpo = await resposta.json();
    assert.deepEqual(Object.keys(corpo).sort(), ['adiadas', 'avancadas', 'codigos', 'concluidas', 'encontradas', 'falhas', 'perdidas', 'reservadas']);
    for (const chave of Object.keys(corpo).filter((k) => k !== 'codigos')) assert.ok(Number.isInteger(corpo[chave]) && corpo[chave] >= 0, chave);
    assert.equal(typeof corpo.codigos, 'object');
    assert.ok(corpo.codigos !== null && !Array.isArray(corpo.codigos));
    const permitidos = ['ia_nao_configurada', 'ia_limite', 'ia_saida_invalida', 'ia_falha', 'ia_tempo', 'brain_indisponivel', 'gate_reprovado', 'correcao_nao_convergiu', 'interno'];
    for (const [codigo, quantidade] of Object.entries(corpo.codigos)) {
      assert.ok(permitidos.includes(codigo), codigo);
      assert.ok(Number.isInteger(quantidade) && quantidade > 0, codigo);
    }
  });
});
