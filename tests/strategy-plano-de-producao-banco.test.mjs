import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { PG_CONTAINER as CONTAINER } from './apoio/pgContainer.mjs';
import { psqlComoRole } from './apoio/psql.mjs';
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
    const existe = dono("SELECT to_regclass('core.strategy_production_plans') IS NOT NULL");
    return existe === 't' ? null : `container ${CONTAINER} sem a migração 0154 aplicada`;
  } catch (falha) {
    return `Postgres do container ${CONTAINER} indisponível (${String(falha.message).split('\n')[0]})`;
  }
})();

if (disponibilidade && process.env.CI) {
  describe('Plano de produção no banco (0154)', () => {
    it('o Postgres do harness precisa estar disponível e migrado no CI', () => {
      assert.fail(disponibilidade);
    });
  });
}

const CONTEUDO = { schema_version: 1, janela: { inicio: '2026-12-01', fim: '2027-02-28' }, campanhas: [], referencias: [] };

describe('Plano de produção no banco (0154)', { concurrency: false, skip: disponibilidade && !process.env.CI ? disponibilidade : disponibilidade ? true : false }, () => {
  const ids = {};
  const criadas = { orgs: [], clientes: [], usuarios: [] };
  const org = (nome) => {
    const id = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Prod ${nome} ${sufixo}', 'prod-${nome}-${sufixo}', 'agency') RETURNING id`);
    criadas.orgs.push(id);
    return id;
  };
  const cliente = (organizacao, nome) => {
    const id = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${organizacao}', '${nome} ${sufixo}', 'leads') RETURNING id`);
    criadas.clientes.push(id);
    return id;
  };
  const usuario = (nome) => {
    const id = dono(`INSERT INTO core.users (email, name) VALUES ('prod-${nome}-${sufixo}@tria.local', '${nome}') RETURNING id`);
    criadas.usuarios.push(id);
    return id;
  };
  const membro = (organizacao, quem, papel) => dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${organizacao}', '${quem}', '${papel}') RETURNING id`);
  const tornarVigente = (versao) =>
    dono(`SET session_replication_role = replica; UPDATE core.strategy_plan_versions SET status = 'vigente' WHERE id = '${versao}' RETURNING id`);

  const pedir = (organizacao, quem, { cli, plano, versao }) =>
    comoApp(
      organizacao,
      quem,
      `INSERT INTO core.strategy_production_plans (organization_id, client_id, plan_id, version_id, numero, agent_run_id, requested_by)
       VALUES ('${organizacao}', '${cli}', '${plano}', '${versao}', 1, 'producao-${randomBytes(5).toString('hex')}', ${aspas(quem)}) RETURNING numero || ':' || id;`,
    );
  const reservar = (organizacao, id) =>
    comoWorker(organizacao, `UPDATE core.strategy_production_plans SET tentativas = tentativas + 1, lease_until = now() + interval '5 minutes' WHERE id = '${id}' RETURNING tentativas || ':' || status;`);

  before(() => {
    ids.orgA = org('a');
    ids.orgB = org('b');
    ids.cliA = cliente(ids.orgA, 'cli-a');
    ids.cliB = cliente(ids.orgB, 'cli-b');
    ids.cliA2 = cliente(ids.orgA, 'cli-a2');
    ids.donoA = usuario('dono-a');
    ids.operador = usuario('operador');
    ids.leitor = usuario('leitor');
    ids.donoB = usuario('dono-b');
    membro(ids.orgA, ids.donoA, 'owner');
    membro(ids.orgA, ids.operador, 'operator');
    membro(ids.orgA, ids.leitor, 'viewer');
    membro(ids.orgB, ids.donoB, 'owner');
    const sem = criarSemeadorDeEstrategia({ org: ids.orgA, operador: ids.operador });
    ids.plano = sem.planoNovo(ids.cliA);
    ids.versao = sem.versaoRascunho(ids.cliA, ids.plano, { schema_version: 1 });
    tornarVigente(ids.versao);
    ids.planoRascunho = sem.planoNovo(ids.cliA);
    ids.versaoRascunho = sem.versaoRascunho(ids.cliA, ids.planoRascunho, { schema_version: 1 });
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

  it('operator pede a partir da versão vigente; nasce pendente com numero 1', () => {
    const [numero, id] = pedir(ids.orgA, ids.operador, { cli: ids.cliA, plano: ids.plano, versao: ids.versao }).split(':');
    assert.equal(numero, '1');
    ids.primeira = id;
    assert.equal(dono(`SELECT status || ':' || tentativas || ':' || (conteudo IS NULL) FROM core.strategy_production_plans WHERE id = '${id}'`), 'pendente:0:true');
  });

  it('uma pendente por plano', () => {
    const erro = recusa(() => pedir(ids.orgA, ids.donoA, { cli: ids.cliA, plano: ids.plano, versao: ids.versao }));
    assert.match(erro ?? '', /strategy_production_plans_uma_pendente/);
  });

  it('viewer não pede; versão rascunho não serve; o worker não insere', () => {
    assert.match(recusa(() => pedir(ids.orgA, ids.leitor, { cli: ids.cliA, plano: ids.planoRascunho, versao: ids.versaoRascunho })) ?? '', /owner, admin ou operator/);
    assert.match(recusa(() => pedir(ids.orgA, ids.operador, { cli: ids.cliA, plano: ids.planoRascunho, versao: ids.versaoRascunho })) ?? '', /versão vigente/);
    const doWorker = recusa(() =>
      comoWorker(ids.orgA, `INSERT INTO core.strategy_production_plans (organization_id, client_id, plan_id, version_id, numero, agent_run_id) VALUES ('${ids.orgA}', '${ids.cliA}', '${ids.planoRascunho}', '${ids.versaoRascunho}', 1, 'producao-worker-${sufixo}');`),
    );
    assert.match(doWorker ?? '', /nunca do worker|insufficient|42501/i);
  });

  it('RLS: outra organização não vê nem escreve no cliente alheio', () => {
    assert.equal(comoApp(ids.orgB, ids.donoB, `SELECT count(*) FROM core.strategy_production_plans WHERE plan_id = '${ids.plano}'`), '0');
    const erro = recusa(() => pedir(ids.orgB, ids.donoB, { cli: ids.cliA, plano: ids.plano, versao: ids.versao }));
    assert.ok(erro !== null);
    assert.equal(comoWorker(ids.orgB, `SELECT count(*) FROM core.strategy_production_plans WHERE id = '${ids.primeira}'`), '0');
  });

  it('membro da mesma organização restrito a outro cliente não vê nem pede', () => {
    const recorte = (sql) => psqlComoRole('orla_app', `SET app.organization_id = '${ids.orgA}'; SET app.client_ids = '${ids.cliA2}'; SET app.user_id = '${ids.operador}'; ${sql}`).split('\n').at(-1).trim();
    assert.equal(recorte(`SELECT count(*) FROM core.strategy_production_plans WHERE plan_id = '${ids.plano}'`), '0');
    const erro = recusa(() =>
      recorte(`INSERT INTO core.strategy_production_plans (organization_id, client_id, plan_id, version_id, numero, agent_run_id, requested_by)
               VALUES ('${ids.orgA}', '${ids.cliA}', '${ids.plano}', '${ids.versao}', 1, 'producao-recorte-${sufixo}', '${ids.operador}') RETURNING id;`),
    );
    assert.match(erro ?? '', /fora do contexto|row-level security|insufficient/i);
  });

  it('o app não atualiza nem apaga; o dono não apaga enquanto o cliente existe', () => {
    assert.match(recusa(() => comoApp(ids.orgA, ids.donoA, `UPDATE core.strategy_production_plans SET status = 'falhou' WHERE id = '${ids.primeira}'`)) ?? '', /permission denied/);
    assert.match(recusa(() => comoApp(ids.orgA, ids.donoA, `DELETE FROM core.strategy_production_plans WHERE id = '${ids.primeira}'`)) ?? '', /permission denied/);
    assert.match(recusa(() => dono(`DELETE FROM core.strategy_production_plans WHERE id = '${ids.primeira}'`)) ?? '', /não se apaga/);
  });

  it('descoberta só pelo worker e sem conteúdo', () => {
    const achadas = comoWorker(ids.orgA, `SELECT count(*) FROM core.strategy_producao_pendentes(20) WHERE id = '${ids.primeira}'`);
    assert.equal(achadas, '1');
    assert.match(recusa(() => comoApp(ids.orgA, ids.donoA, 'SELECT * FROM core.strategy_producao_pendentes(5)')) ?? '', /permission denied/);
  });

  it('worker: escrita sem lease é recusada; reserva sobe a ficha; progresso com lease vigente', () => {
    assert.match(recusa(() => comoWorker(ids.orgA, `UPDATE core.strategy_production_plans SET progresso = '{"cp": {}}' WHERE id = '${ids.primeira}'`)) ?? '', /lease vigente/);
    assert.equal(reservar(ids.orgA, ids.primeira), '1:pendente');
    assert.match(recusa(() => comoWorker(ids.orgA, `UPDATE core.strategy_production_plans SET lease_until = now() + interval '2 hours' WHERE id = '${ids.primeira}'`)) ?? '', /15 minutos/);
    assert.match(recusa(() => reservar(ids.orgA, ids.primeira)) ?? '', /lease livre ou vencido/);
    comoWorker(ids.orgA, `UPDATE core.strategy_production_plans SET progresso = '{"cp": {"ok": true}}' WHERE id = '${ids.primeira}' RETURNING id;`);
    assert.match(recusa(() => comoWorker(ids.orgA, `UPDATE core.strategy_production_plans SET version_id = '${ids.versaoRascunho}' WHERE id = '${ids.primeira}'`)) ?? '', /permission denied|só muda/);
  });

  it('pronto exige conteúdo e lease liberado; estado final é imutável', () => {
    assert.match(recusa(() => comoWorker(ids.orgA, `UPDATE core.strategy_production_plans SET status = 'pronto', progresso = '{}' WHERE id = '${ids.primeira}'`)) ?? '', /conteúdo/);
    comoWorker(
      ids.orgA,
      `UPDATE core.strategy_production_plans SET status = 'pronto', conteudo = ${aspas(JSON.stringify(CONTEUDO))}::jsonb, progresso = '{}', lease_until = NULL WHERE id = '${ids.primeira}' RETURNING id;`,
    );
    assert.equal(dono(`SELECT status || ':' || (concluido_em IS NOT NULL) FROM core.strategy_production_plans WHERE id = '${ids.primeira}'`), 'pronto:true');
    assert.match(recusa(() => reservar(ids.orgA, ids.primeira)) ?? '', /estado final/);
  });

  it('gerar de novo cria nova linha com numero 2 e não toca a anterior', () => {
    const [numero, id] = pedir(ids.orgA, ids.operador, { cli: ids.cliA, plano: ids.plano, versao: ids.versao }).split(':');
    assert.equal(numero, '2');
    ids.segunda = id;
    assert.equal(dono(`SELECT count(*) FROM core.strategy_production_plans WHERE plan_id = '${ids.plano}' AND status = 'pronto'`), '1');
  });

  it('teto de reservas encerra como falhou/interno', () => {
    dono(`SET session_replication_role = replica; UPDATE core.strategy_production_plans SET tentativas = 40 WHERE id = '${ids.segunda}' RETURNING id`);
    assert.equal(reservar(ids.orgA, ids.segunda), '41:falhou');
    assert.equal(dono(`SELECT erro_codigo || ':' || motivo FROM core.strategy_production_plans WHERE id = '${ids.segunda}'`), 'interno:teto_de_reservas');
  });

  it('a redação LGPD do plano redige o conteúdo do plano de produção', () => {
    ids.terceira = pedir(ids.orgA, ids.operador, { cli: ids.cliA, plano: ids.plano, versao: ids.versao }).split(':')[1];
    reservar(ids.orgA, ids.terceira);
    comoWorker(ids.orgA, `UPDATE core.strategy_production_plans SET progresso = '{"cp": {"texto": "do modelo"}}' WHERE id = '${ids.terceira}' RETURNING id;`);
    dono(`SELECT core.redigir_plano('${ids.versao}', 'teste de redação')`);
    assert.equal(
      dono(`SELECT status || ':' || erro_codigo || ':' || motivo || ':' || progresso::text || ':' || (redigido_em IS NOT NULL) FROM core.strategy_production_plans WHERE id = '${ids.terceira}'`),
      'falhou:plano_fora_do_estado:redigido:{}:true',
    );
    assert.match(recusa(() => comoWorker(ids.orgA, `UPDATE core.strategy_production_plans SET progresso = '{"cp": {}}' WHERE id = '${ids.terceira}'`)) ?? '', /estado final|redigido/);
    assert.equal(
      dono(`SELECT conteudo::text || ':' || (redigido_em IS NOT NULL) FROM core.strategy_production_plans WHERE id = '${ids.primeira}'`),
      '{"redigido": true}:true',
    );
    assert.equal(dono(`SELECT (conteudo IS NULL) || ':' || (redigido_em IS NOT NULL) FROM core.strategy_production_plans WHERE id = '${ids.segunda}'`), 'true:true');
  });

  it('o expurgo do cliente leva o plano de produção em cascata', () => {
    const cli = cliente(ids.orgA, 'expurgo');
    const sem = criarSemeadorDeEstrategia({ org: ids.orgA, operador: ids.operador });
    const plano = sem.planoNovo(cli);
    const versao = sem.versaoRascunho(cli, plano, { schema_version: 1 });
    tornarVigente(versao);
    pedir(ids.orgA, ids.operador, { cli, plano, versao });
    dono(`DELETE FROM core.clients WHERE id = '${cli}'`);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_production_plans WHERE client_id = '${cli}'`), '0');
  });
});
