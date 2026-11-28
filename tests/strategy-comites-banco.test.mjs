import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { PG_CONTAINER as CONTAINER } from './apoio/pgContainer.mjs';
import { aspas, comoApp, comoWorker, criarSemeadorDeEstrategia, dono } from './apoio/semearEstrategia.mjs';

const sufixo = randomBytes(4).toString('hex');
const recusa = (fn) => {
  try {
    fn();
    return null;
  } catch (falha) {
    return String(falha.stderr ?? falha.message);
  }
};

const disponibilidade = (() => {
  try {
    const existe = dono("SELECT to_regclass('core.strategy_plan_deliberations') IS NOT NULL AND to_regclass('core.strategy_committee_settings') IS NOT NULL");
    return existe === 't' ? null : `container ${CONTAINER} sem a migração 0153 aplicada`;
  } catch (falha) {
    return `Postgres do container ${CONTAINER} indisponível (${String(falha.message).split('\n')[0]})`;
  }
})();

if (disponibilidade && process.env.CI) {
  describe('Comitês do planejador no banco (0153)', () => {
    it('o Postgres do harness precisa estar disponível e migrado no CI', () => {
      assert.fail(disponibilidade);
    });
  });
}

const PARECER = (membro) => ({ persona: membro, veredito: 'aprova', motivo: 'Sem objeção.', pontos: [] });
const MESA = (comite, rodada) => ({ comite, rodada, debate: [{ membro: comite, reageA: 'comite', posicao: 'Concordo.', mudouDeOpiniao: false }], consensos: [], divergencias: [] });

describe('Comitês do planejador no banco (0153)', { concurrency: false, skip: disponibilidade && !process.env.CI ? disponibilidade : disponibilidade ? true : false }, () => {
  const ids = {};
  const criadas = { orgs: [], clientes: [], usuarios: [] };
  const org = (nome) => {
    const id = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Com ${nome} ${sufixo}', 'com-${nome}-${sufixo}', 'agency') RETURNING id`);
    criadas.orgs.push(id);
    return id;
  };
  const cliente = (organizacao, nome) => {
    const id = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${organizacao}', '${nome} ${sufixo}', 'leads') RETURNING id`);
    criadas.clientes.push(id);
    return id;
  };
  const usuario = (nome) => {
    const id = dono(`INSERT INTO core.users (email, name) VALUES ('com-${nome}-${sufixo}@tria.local', '${nome}') RETURNING id`);
    criadas.usuarios.push(id);
    return id;
  };
  const membro = (organizacao, quem, papel) => dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${organizacao}', '${quem}', '${papel}') RETURNING id`);

  const deliberar = (organizacao, { cli, plano, versao, execucao, comite = 'redator', rodada = 0, membro: quem = rodada === 0 ? 'redator' : null, payload, ficha = execucao.tentativas }) =>
    comoWorker(
      organizacao,
      `${ficha === null ? '' : `DO $$ BEGIN PERFORM set_config('orla.ficha_execucao', '${ficha}', true); END $$;`}
       INSERT INTO core.strategy_plan_deliberations (organization_id, client_id, plan_id, version_id, execution_id, comite, rodada, membro, payload, agent_run_id)
       VALUES ('${organizacao}', '${cli}', '${plano}', '${versao}', '${execucao.id}', '${comite}', ${rodada}, ${aspas(quem)},
               ${aspas(JSON.stringify(payload ?? (rodada === 0 ? PARECER(quem) : MESA(comite, rodada))))}::jsonb, '${execucao.agentRunId}') RETURNING rodada;`,
    );

  before(() => {
    ids.orgA = org('a');
    ids.orgB = org('b');
    ids.cliA = cliente(ids.orgA, 'cli-a');
    ids.cliB = cliente(ids.orgB, 'cli-b');
    ids.donoA = usuario('dono-a');
    ids.adminA = usuario('admin-a');
    ids.operador = usuario('operador');
    ids.leitor = usuario('leitor');
    ids.donoB = usuario('dono-b');
    membro(ids.orgA, ids.donoA, 'owner');
    membro(ids.orgA, ids.adminA, 'admin');
    membro(ids.orgA, ids.operador, 'operator');
    membro(ids.orgA, ids.leitor, 'viewer');
    membro(ids.orgB, ids.donoB, 'owner');
    ids.semA = criarSemeadorDeEstrategia({ org: ids.orgA, operador: ids.operador });
    ids.semB = criarSemeadorDeEstrategia({ org: ids.orgB, operador: ids.donoB });
  });

  after(() => {
    for (const id of criadas.clientes) dono(`DELETE FROM core.clients WHERE id = '${id}'`);
    for (const id of criadas.orgs) dono(`DELETE FROM core.strategy_committee_settings WHERE organization_id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.members WHERE user_id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.users WHERE id = '${id}'`);
    for (const id of criadas.orgs) dono(`DELETE FROM core.organizations WHERE id = '${id}'`);
  });

  const cenario = (sem = ids.semA, cli = ids.cliA) => {
    const plano = sem.planoNovo(cli);
    const execucao = sem.iniciarExecucao({ cli, plano });
    const versao = sem.versaoRascunho(cli, plano, { intencao: { horizonte: '12m' } });
    return { cli, plano, versao, execucao };
  };

  describe('deliberações', () => {
    it('o worker com execução ativa e ficha grava parecer de membro e as duas mesas; a mesma linha de novo é recusada pelo único', () => {
      const c = cenario();
      assert.equal(deliberar(ids.orgA, c), '0');
      assert.equal(deliberar(ids.orgA, { ...c, rodada: 1 }), '1');
      assert.equal(deliberar(ids.orgA, { ...c, rodada: 2 }), '2');
      assert.equal(deliberar(ids.orgA, { ...c, membro: 'checador_de_promessas' }), '0');
      assert.match(recusa(() => deliberar(ids.orgA, c)) ?? '', /strategy_plan_deliberations_unica/);
      assert.match(recusa(() => deliberar(ids.orgA, { ...c, rodada: 1 })) ?? '', /strategy_plan_deliberations_unica/);
    });

    it('membro só na rodada 0 e payload no formato da rodada', () => {
      const c = cenario();
      assert.match(recusa(() => deliberar(ids.orgA, { ...c, rodada: 0, membro: null, payload: PARECER('redator') })) ?? '', /membro_na_rodada0|persona igual ao membro/);
      assert.match(recusa(() => deliberar(ids.orgA, { ...c, rodada: 1, membro: 'redator' })) ?? '', /membro_na_rodada0/);
      assert.match(recusa(() => deliberar(ids.orgA, { ...c, rodada: 3 })) ?? '', /rodada_check|violates check/);
      assert.match(recusa(() => deliberar(ids.orgA, { ...c, payload: PARECER('outro_membro') })) ?? '', /persona igual ao membro/);
      assert.match(recusa(() => deliberar(ids.orgA, { ...c, rodada: 2, payload: MESA('redator', 1) })) ?? '', /payload.comite e payload.rodada/);
    });

    it('agente sem execução ativa é recusado: sem ficha, ficha errada, execução cancelada ou de outro plano', () => {
      const c = cenario();
      assert.match(recusa(() => deliberar(ids.orgA, { ...c, ficha: null })) ?? '', /exige execução ativa e a ficha/);
      assert.match(recusa(() => deliberar(ids.orgA, { ...c, ficha: 7 })) ?? '', /exige execução ativa deste plano/);
      const outro = cenario();
      assert.match(recusa(() => deliberar(ids.orgA, { ...c, execucao: outro.execucao })) ?? '', /exige execução ativa deste plano/);
      comoApp(ids.orgA, ids.operador, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${c.execucao.id}' RETURNING id`);
      assert.match(recusa(() => deliberar(ids.orgA, c)) ?? '', /exige execução ativa deste plano/);
    });

    it('o app (pessoa) não grava deliberação, nem com papel de dono', () => {
      const c = cenario();
      const sql = `INSERT INTO core.strategy_plan_deliberations (organization_id, client_id, plan_id, version_id, execution_id, comite, rodada, membro, payload, agent_run_id)
        VALUES ('${ids.orgA}', '${c.cli}', '${c.plano}', '${c.versao}', '${c.execucao.id}', 'redator', 0, 'redator', ${aspas(JSON.stringify(PARECER('redator')))}::jsonb, '${c.execucao.agentRunId}')`;
      assert.match(recusa(() => comoApp(ids.orgA, ids.donoA, sql)) ?? '', /só pela credencial do worker/);
      const comFicha = `DO $$ BEGIN PERFORM set_config('orla.ficha_execucao', '${c.execucao.tentativas}', true); END $$; ${sql}`;
      assert.match(recusa(() => comoApp(ids.orgA, '', comFicha)) ?? '', /só pela credencial do worker/, 'o pool da web sem pessoa também não grava, nem com a ficha');
      assert.match(recusa(() => comoWorker(ids.orgA, `SET app.user_id = '${ids.donoA}'; ${comFicha}`)) ?? '', /não pode carregar app.user_id/);
    });

    it('imutável: UPDATE e DELETE são recusados até para o dono do banco; o expurgo do cliente leva', () => {
      const c = cenario();
      deliberar(ids.orgA, c);
      assert.match(recusa(() => dono(`UPDATE core.strategy_plan_deliberations SET payload = '{}'::jsonb WHERE version_id = '${c.versao}'`)) ?? '', /imutável/);
      assert.match(recusa(() => comoWorker(ids.orgA, `UPDATE core.strategy_plan_deliberations SET payload = '{}'::jsonb WHERE version_id = '${c.versao}'`)) ?? '', /permission denied|imutável/);
      assert.match(recusa(() => dono(`DELETE FROM core.strategy_plan_deliberations WHERE version_id = '${c.versao}'`)) ?? '', /não se apaga/);
      assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_deliberations WHERE version_id = '${c.versao}'`), '1');
    });

    it('RLS forçada: outra organização não vê nem grava na versão de A', () => {
      const c = cenario();
      deliberar(ids.orgA, c);
      assert.equal(comoWorker(ids.orgB, `SELECT count(*) FROM core.strategy_plan_deliberations WHERE version_id = '${c.versao}'`), '0');
      assert.equal(comoApp(ids.orgB, ids.donoB, `SELECT count(*) FROM core.strategy_plan_deliberations WHERE version_id = '${c.versao}'`), '0');
      assert.equal(comoWorker(ids.orgA, `SELECT count(*) FROM core.strategy_plan_deliberations WHERE version_id = '${c.versao}'`), '1');
      assert.match(recusa(() => deliberar(ids.orgB, { ...c, membro: 'checador_de_promessas' })) ?? '', /fora do contexto|row-level/);
      const b = cenario(ids.semB, ids.cliB);
      assert.equal(deliberar(ids.orgB, b), '0');
      assert.equal(comoWorker(ids.orgA, `SELECT count(*) FROM core.strategy_plan_deliberations WHERE version_id = '${b.versao}'`), '0');
    });

    it('a redação LGPD do plano troca o payload das deliberações', () => {
      const c = cenario();
      deliberar(ids.orgA, c);
      deliberar(ids.orgA, { ...c, rodada: 1 });
      comoWorker(ids.orgA, `SELECT core.redigir_plano('${c.versao}', 'pedido do titular')`);
      assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_deliberations WHERE version_id = '${c.versao}' AND payload <> '{"redigido": true}'::jsonb`), '0');
      assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_deliberations WHERE version_id = '${c.versao}'`), '2');
    });
  });

  describe('configuração dos comitês', () => {
    const definir = (quem, comite, ligado, organizacao = ids.orgA) =>
      comoApp(
        organizacao,
        quem,
        `INSERT INTO core.strategy_committee_settings (organization_id, comite, ligado) VALUES ('${organizacao}', '${comite}', ${ligado})
         ON CONFLICT (organization_id, comite) DO UPDATE SET ligado = EXCLUDED.ligado RETURNING ligado::text || '|' || (atualizado_por IS NOT NULL)::text`,
      );

    it('owner e admin ligam e desligam; o autor é fixado pelo gatilho', () => {
      assert.equal(definir(ids.donoA, 'cultura', false), 'false|true');
      assert.equal(definir(ids.adminA, 'cultura', true), 'true|true');
      assert.equal(dono(`SELECT atualizado_por FROM core.strategy_committee_settings WHERE organization_id = '${ids.orgA}' AND comite = 'cultura'`), ids.adminA);
    });

    it('operador, leitor, sessão sem pessoa e o worker não escrevem', () => {
      assert.match(recusa(() => definir(ids.operador, 'marca', false)) ?? '', /exige papel owner ou admin/);
      assert.match(recusa(() => definir(ids.leitor, 'marca', false)) ?? '', /exige papel owner ou admin/);
      assert.match(recusa(() => definir('', 'marca', false)) ?? '', /exige papel owner ou admin/);
      assert.match(
        recusa(() => comoWorker(ids.orgA, `INSERT INTO core.strategy_committee_settings (organization_id, comite, ligado) VALUES ('${ids.orgA}', 'marca', false)`)) ?? '',
        /exige papel owner ou admin/,
      );
    });

    it('risco_legal nunca fica desligado: gatilho para o app e CHECK até para o dono do banco', () => {
      assert.match(recusa(() => definir(ids.donoA, 'risco_legal', false)) ?? '', /não pode ser desligado/);
      assert.match(recusa(() => dono(`INSERT INTO core.strategy_committee_settings (organization_id, comite, ligado) VALUES ('${ids.orgA}', 'risco_legal', false)`)) ?? '', /não pode ser desligado|risco_legal_ligado/);
      assert.equal(definir(ids.donoA, 'risco_legal', true), 'true|true');
    });

    it('outra organização não vê nem escreve a configuração de A', () => {
      definir(ids.donoA, 'producao', false);
      assert.equal(comoApp(ids.orgB, ids.donoB, `SELECT count(*) FROM core.strategy_committee_settings WHERE organization_id = '${ids.orgA}'`), '0');
      assert.match(recusa(() => definir(ids.donoB, 'producao', true, ids.orgA)) ?? '', /exige papel owner ou admin|row-level|fora do contexto/);
      assert.match(
        recusa(() => comoApp(ids.orgB, ids.donoB, `INSERT INTO core.strategy_committee_settings (organization_id, comite, ligado) VALUES ('${ids.orgA}', 'producao', true)`)) ?? '',
        /fora do contexto|row-level/,
      );
      assert.equal(dono(`SELECT ligado::text FROM core.strategy_committee_settings WHERE organization_id = '${ids.orgA}' AND comite = 'producao'`), 'false');
    });
  });
});
