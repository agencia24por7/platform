import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { PG_CONTAINER as CONTAINER } from './apoio/pgContainer.mjs';

const sufixo = randomBytes(4).toString('hex');
const executar = promisify(execFile);

const variavel = (nome) => {
  if (process.env[nome]) return process.env[nome];
  const linha = readFileSync('.env', 'utf8')
    .split('\n')
    .find((candidata) => candidata.startsWith(`${nome}=`));
  return linha.slice(nome.length + 1);
};

const argumentos = (usuario, senha, sql) => [
  'exec',
  '-i',
  ...(senha ? ['-e', `PGPASSWORD=${senha}`] : []),
  CONTAINER,
  'psql',
  '-U',
  usuario,
  ...(senha ? ['-h', '127.0.0.1'] : []),
  '-d',
  'tria',
  '-v',
  'VERBOSITY=verbose',
  '-qtAc',
  sql,
];

const psql = (usuario, senha, sql) => execFileSync('docker', argumentos(usuario, senha, sql), { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const ultimaLinha = (texto) => texto.split('\n').at(-1).trim();
const dono = (sql) => ultimaLinha(psql('postgres', null, sql));
const contexto = (organizacao, clientes, usuario) =>
  `SET app.organization_id = '${organizacao}'; SET app.client_ids = '${clientes}'; SET app.user_id = '${usuario ?? ''}'; `;
const comoApp = (organizacao, clientes, usuario, sql) => ultimaLinha(psql('orla_app', variavel('APP_DB_PASSWORD'), contexto(organizacao, clientes, usuario) + sql));
const comoWorker = (organizacao, clientes, usuario, sql) => ultimaLinha(psql('orla_worker', variavel('WORKER_DB_PASSWORD'), contexto(organizacao, clientes, usuario) + sql));

const recusa = (fn) => {
  try {
    fn();
    return null;
  } catch (falha) {
    return String(falha.stderr ?? falha.message);
  }
};

const aspas = (valor) => (valor === null || valor === undefined ? 'NULL' : `'${String(valor).replaceAll("'", "''")}'`);

const disponibilidade = (() => {
  try {
    const existe = ultimaLinha(psql('postgres', null, "SELECT to_regclass('core.strategy_plan_runs') IS NOT NULL AND to_regprocedure('core.redigir_plano(uuid,text)') IS NOT NULL"));
    return existe === 't' ? null : `container ${CONTAINER} sem a migração 0147 aplicada`;
  } catch (falha) {
    return `Postgres do container ${CONTAINER} indisponível (${String(falha.message).split('\n')[0]})`;
  }
})();

if (disponibilidade && process.env.CI) {
  describe('Strategy Plan, execuções e repositório (migração 0147)', () => {
    it('o Postgres do harness precisa estar disponível e migrado no CI', () => {
      assert.fail(disponibilidade);
    });
  });
}

const pular = disponibilidade && !process.env.CI ? disponibilidade : disponibilidade ? true : false;

const INTENCAO = JSON.stringify({
  objetivo: 'Gerar leads qualificados',
  horizonte: { inicio: '2026-12-01', fim: '2027-02-28' },
  ousadia: 'moderado',
  retorno_esperado: { descricao: 'Custo por lead abaixo da meta' },
  verba: { unidade: 'brl_centavos', centavos: '1000000', moeda: 'BRL' },
});

describe('Strategy Plan, execuções (migração 0147, ADR 0065 §9)', { concurrency: false, skip: pular }, () => {
  const ids = {};
  const criadas = { clientes: [], orgs: [], usuarios: [] };

  const org = (nome) => {
    const id = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Exec ${nome} ${sufixo}', 'exec-${nome}-${sufixo}', 'agency') RETURNING id`);
    criadas.orgs.push(id);
    return id;
  };
  const cliente = (organizacao, nome) => {
    const id = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${organizacao}', '${nome} ${sufixo}', 'leads') RETURNING id`);
    criadas.clientes.push(id);
    return id;
  };
  const usuario = (nome) => {
    const id = dono(`INSERT INTO core.users (email, name) VALUES ('exec-${nome}-${sufixo}@tria.local', '${nome}') RETURNING id`);
    criadas.usuarios.push(id);
    return id;
  };
  const membro = (organizacao, quem, papel) =>
    dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${organizacao}', '${quem}', '${papel}') RETURNING id`);
  const novoPlano = (cli = ids.cliA, organizacao = ids.orgA) =>
    dono(`INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key) VALUES ('${organizacao}', '${cli}', 't${randomBytes(3).toString('hex')}') RETURNING id`);

  const sqlExecucao = ({ organizacao = ids.orgA, cli = ids.cliA, plano, tipo = 'criar', pedido = INTENCAO, base = null, run, por, kind = 'usuario' }) =>
    `INSERT INTO core.strategy_plan_runs (organization_id, client_id, plan_id, kind, pedido, base_version_id, agent_run_id, requested_by, requested_kind)
     VALUES (${aspas(organizacao)}, ${aspas(cli)}, ${aspas(plano)}, ${aspas(tipo)}, ${aspas(pedido)}::jsonb, ${aspas(base)}, ${aspas(run ?? `run-${randomBytes(5).toString('hex')}`)}, ${aspas(por)}, ${aspas(kind)}) RETURNING id;`;

  const pedir = (plano, quem = ids.operador, extra = {}) => comoApp(ids.orgA, '*', quem, sqlExecucao({ plano, por: quem, ...extra }));
  const status = (id) => dono(`SELECT status || '/' || etapa || '/' || rodada || '/' || tentativas FROM core.strategy_plan_runs WHERE id = '${id}'`);
  const doWorker = (sql) => comoWorker(ids.orgA, '*', '', sql);
  const reservar = (id) =>
    doWorker(`UPDATE core.strategy_plan_runs SET status = 'rodando', tentativas = tentativas + 1, lease_until = now() + interval '5 minutes' WHERE id = '${id}' RETURNING id;`);

  before(() => {
    ids.orgA = org('a');
    ids.orgB = org('b');
    ids.cliA = cliente(ids.orgA, 'cli-a');
    ids.cliA2 = cliente(ids.orgA, 'cli-a2');
    ids.cliB = cliente(ids.orgB, 'cli-b');
    ids.dono = usuario('dono');
    ids.admin = usuario('admin');
    ids.operador = usuario('operador');
    ids.leitor = usuario('leitor');
    ids.donoB = usuario('dono-b');
    ids.naoMembro = usuario('fora');
    ids.recortado = usuario('recortado');
    membro(ids.orgA, ids.dono, 'owner');
    membro(ids.orgA, ids.admin, 'admin');
    membro(ids.orgA, ids.operador, 'operator');
    membro(ids.orgA, ids.leitor, 'viewer');
    membro(ids.orgB, ids.donoB, 'owner');
    const idRecortado = membro(ids.orgA, ids.recortado, 'operator');
    dono(`INSERT INTO core.member_clients (member_id, client_id) VALUES ('${idRecortado}', '${ids.cliA2}')`);
  });

  after(() => {
    for (const id of criadas.clientes) dono(`DELETE FROM core.member_clients WHERE client_id = '${id}'`);
    for (const id of criadas.clientes) dono(`DELETE FROM core.clients WHERE id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.members WHERE user_id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.users WHERE id = '${id}'`);
    for (const id of criadas.orgs) dono(`DELETE FROM core.organizations WHERE id = '${id}'`);
  });

  it('operator, admin e owner pedem; a execução nasce pendente em ler_brain com a pessoa que pediu', () => {
    for (const quem of [ids.operador, ids.admin, ids.dono]) {
      const id = pedir(novoPlano(), quem);
      assert.equal(status(id), 'pendente/ler_brain/0/0');
      assert.equal(dono(`SELECT requested_by || '/' || requested_kind FROM core.strategy_plan_runs WHERE id = '${id}'`), `${quem}/usuario`);
    }
  });

  it('viewer, não membro e pessoa em nome de outra são negados; sistema só pelo worker', () => {
    const plano = novoPlano();
    assert.match(recusa(() => pedir(plano, ids.leitor)) ?? '', /42501/);
    assert.match(recusa(() => pedir(plano, ids.naoMembro)) ?? '', /42501/);
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.operador, sqlExecucao({ plano, por: ids.dono }))) ?? '', /42501/);
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.operador, sqlExecucao({ plano, por: null, kind: 'sistema' }))) ?? '', /42501|23514/);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlExecucao({ plano, por: ids.operador }))) ?? '', /42501/);
    assert.match(recusa(() => doWorker(sqlExecucao({ plano, por: ids.operador }))) ?? '', /42501/);
    const sistema = doWorker(sqlExecucao({ plano, por: null, kind: 'sistema' }));
    assert.equal(status(sistema), 'pendente/ler_brain/0/0');
  });

  it('a execução nasce sem andamento, erro nem lease', () => {
    const plano = novoPlano();
    const forjada = `INSERT INTO core.strategy_plan_runs (organization_id, client_id, plan_id, kind, pedido, agent_run_id, requested_by, requested_kind, status, etapa)
      VALUES ('${ids.orgA}', '${ids.cliA}', '${plano}', 'criar', '${INTENCAO}'::jsonb, 'run-${randomBytes(4).toString('hex')}', '${ids.operador}', 'usuario', 'rodando', 'comite')`;
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.operador, forjada)) ?? '', /23514.*nasce pendente/s);
  });

  it('no máximo uma execução ativa por plano; depois de cancelar, outra entra', () => {
    const plano = novoPlano();
    const primeira = pedir(plano);
    assert.match(recusa(() => pedir(plano, ids.admin)) ?? '', /23505.*strategy_plan_runs_uma_ativa/s);
    comoApp(ids.orgA, '*', ids.operador, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${primeira}'`);
    const segunda = pedir(plano, ids.admin);
    assert.equal(status(segunda), 'pendente/ler_brain/0/0');
  });

  it('o pedido é validado por tipo e limitado a 8 KB; agent_run_id é único e de lista fechada', () => {
    const plano = novoPlano();
    assert.match(recusa(() => pedir(plano, ids.operador, { tipo: 'ajustar', pedido: '{"instrucao":""}' })) ?? '', /23514/);
    assert.match(recusa(() => pedir(plano, ids.operador, { tipo: 'ajustar', pedido: JSON.stringify({ instrucao: 'a'.repeat(2001) }) })) ?? '', /23514/);
    assert.match(recusa(() => pedir(plano, ids.operador, { tipo: 'ajustar', pedido: '{"instrucao":"ok ok","extra":1}' })) ?? '', /23514/);
    assert.match(recusa(() => pedir(plano, ids.operador, { tipo: 'revisar', pedido: '{"motivo":"outro"}' })) ?? '', /23514/);
    assert.match(recusa(() => pedir(plano, ids.operador, { tipo: 'criar', pedido: JSON.stringify({ texto: 'x'.repeat(9000) }) })) ?? '', /23514/);
    assert.match(recusa(() => pedir(plano, ids.operador, { run: 'com espaço' })) ?? '', /23514/);
    const ok = pedir(plano, ids.operador, { tipo: 'revisar', pedido: '{"motivo":"edicao_manual"}', run: `run-dup-${sufixo}` });
    comoApp(ids.orgA, '*', ids.operador, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${ok}'`);
    assert.match(recusa(() => pedir(plano, ids.operador, { run: `run-dup-${sufixo}` })) ?? '', /23505.*agent_run_id_key/s);
  });

  it('a versão base tem de ser do mesmo plano', () => {
    const planoA = novoPlano();
    const planoB = novoPlano();
    const versao = comoApp(
      ids.orgA,
      '*',
      ids.operador,
      `INSERT INTO core.strategy_plan_versions (organization_id, client_id, plan_id, content, schema_version, author_kind, author_user_id)
       VALUES ('${ids.orgA}', '${ids.cliA}', '${planoB}', '{"a":1}'::jsonb, 1, 'usuario', '${ids.operador}') RETURNING id;`,
    );
    assert.match(recusa(() => pedir(planoA, ids.operador, { tipo: 'revisar', pedido: '{"motivo":"edicao_manual"}', base: versao })) ?? '', /23000.*versão base/s);
    const certa = pedir(planoB, ids.operador, { tipo: 'revisar', pedido: '{"motivo":"edicao_manual"}', base: versao });
    assert.equal(status(certa), 'pendente/ler_brain/0/0');
  });

  it('worker reserva com lease, avança etapa e rodada e conclui; rodando volta a pendente para nova tentativa', () => {
    const id = pedir(novoPlano());
    reservar(id);
    assert.equal(status(id), 'rodando/ler_brain/0/1');
    assert.equal(dono(`SELECT (lease_until > now())::text FROM core.strategy_plan_runs WHERE id = '${id}'`), 'true');
    doWorker(`UPDATE core.strategy_plan_runs SET etapa = 'comite', rodada = 1 WHERE id = '${id}' RETURNING id;`);
    assert.equal(status(id), 'rodando/comite/1/1');
    doWorker(`UPDATE core.strategy_plan_runs SET status = 'pendente', lease_until = NULL WHERE id = '${id}' RETURNING id;`);
    assert.equal(status(id), 'pendente/comite/1/1');
    reservar(id);
    assert.equal(status(id), 'rodando/comite/1/2');
    doWorker(`UPDATE core.strategy_plan_runs SET status = 'concluida', etapa = 'fim' WHERE id = '${id}' RETURNING id;`);
    assert.equal(status(id), 'concluida/fim/1/2');
    assert.equal(dono(`SELECT (updated_at >= created_at)::text FROM core.strategy_plan_runs WHERE id = '${id}'`), 'true');
  });

  it('falha exige código de lista fechada; estado final não muda mais', () => {
    const id = pedir(novoPlano());
    reservar(id);
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET status = 'falhou' WHERE id = '${id}'`)) ?? '', /23514.*falha_com_codigo/s);
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET status = 'falhou', erro_codigo = 'texto livre' WHERE id = '${id}'`)) ?? '', /23514/);
    doWorker(`UPDATE core.strategy_plan_runs SET status = 'falhou', erro_codigo = 'ia_nao_configurada' WHERE id = '${id}' RETURNING id;`);
    assert.equal(status(id), 'falhou/ler_brain/0/1');
    for (const alvo of ["status = 'rodando'", "status = 'pendente'", "etapa = 'comite'", "erro_codigo = NULL"]) {
      assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET ${alvo} WHERE id = '${id}'`)) ?? '', /23514.*estado final/s, alvo);
    }
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.operador, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${id}'`)) ?? '', /23514.*estado final/s);
  });

  const ciclosDeReserva = (id, vezes) =>
    doWorker(`DO $$ BEGIN FOR i IN 1..${vezes} LOOP
      UPDATE core.strategy_plan_runs SET status = 'rodando', tentativas = tentativas + 1, lease_until = now() + interval '5 minutes' WHERE id = '${id}';
      UPDATE core.strategy_plan_runs SET status = 'pendente', lease_until = NULL WHERE id = '${id}';
    END LOOP; END $$;`);

  it('teto de reservas (20): a reserva seguinte vira falhou/interno pelo gatilho, a execução some da descoberta e o plano fica livre', () => {
    const plano = novoPlano();
    const id = pedir(plano);
    ciclosDeReserva(id, 19);
    assert.equal(status(id), 'pendente/ler_brain/0/19');
    reservar(id);
    assert.equal(status(id), 'rodando/ler_brain/0/20', 'a vigésima reserva ainda vale');
    doWorker(`UPDATE core.strategy_plan_runs SET status = 'pendente', lease_until = NULL WHERE id = '${id}' RETURNING id;`);
    const achadas = () => new Set(comoWorker(ids.orgA, '*', '', `SELECT string_agg(id::text, ' ') FROM core.strategy_runs_pendentes(50)`).split(' '));
    assert.ok(achadas().has(id), 'no teto ainda é descoberta para ser encerrada');
    reservar(id);
    assert.equal(status(id), 'falhou/ler_brain/0/21');
    assert.equal(dono(`SELECT erro_codigo || '/' || coalesce(lease_until::text, 'sem-lease') FROM core.strategy_plan_runs WHERE id = '${id}'`), 'interno/sem-lease');
    assert.ok(!achadas().has(id));
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET status = 'rodando' WHERE id = '${id}'`)) ?? '', /23514.*estado final/s);
    pedir(plano);
  });

  it('teto de reservas: pendente para falhou só pela 21ª reserva, nunca por UPDATE direto; o lease vencido também é reescrito', () => {
    const id = pedir(novoPlano());
    ciclosDeReserva(id, 20);
    assert.equal(status(id), 'pendente/ler_brain/0/20');
    for (const alvo of ["status = 'falhou', erro_codigo = 'interno'", "status = 'falhou', erro_codigo = 'interno', tentativas = 21", "status = 'falhou', erro_codigo = 'ia_falha'"]) {
      assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET ${alvo} WHERE id = '${id}'`)) ?? '', /23514/s, alvo);
    }
    reservar(id);
    assert.equal(status(id).split('/')[0], 'falhou');

    const vencida = pedir(novoPlano());
    ciclosDeReserva(vencida, 19);
    reservar(vencida);
    doWorker(`UPDATE core.strategy_plan_runs SET lease_until = now() - interval '1 minute' WHERE id = '${vencida}' RETURNING id;`);
    reservar(vencida);
    assert.equal(status(vencida), 'falhou/ler_brain/0/21');
  });

  it('tentativas só sobe de exatamente 1 e só junto da reserva: pulo, salto grande e subida sem rodando são recusados', () => {
    const id = pedir(novoPlano());
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET tentativas = 1000 WHERE id = '${id}'`)) ?? '', /23514.*tentativas só sobem de 1/s);
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET status = 'rodando', tentativas = tentativas + 2, lease_until = now() + interval '1 minute' WHERE id = '${id}'`)) ?? '', /23514.*tentativas só sobem de 1/s);
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET tentativas = tentativas + 1 WHERE id = '${id}'`)) ?? '', /23514.*tentativas só sobem de 1/s, 'subida sem a reserva');
    assert.equal(status(id), 'pendente/ler_brain/0/0');
    reservar(id);
    assert.equal(status(id), 'rodando/ler_brain/0/1');
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET tentativas = tentativas + 1, etapa = 'redigir' WHERE id = '${id}'`)) ?? '', /23514.*tentativas só sobem de 1/s);
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET status = 'pendente', tentativas = tentativas + 1 WHERE id = '${id}'`)) ?? '', /23514.*tentativas só sobem de 1/s);
    assert.equal(status(id), 'rodando/ler_brain/0/1');
  });

  it('toda reserva sobe tentativas: pendente para rodando e retomada de lease vencido sem incremento são recusados', () => {
    const id = pedir(novoPlano());
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET status = 'rodando', lease_until = now() + interval '1 minute' WHERE id = '${id}'`)) ?? '', /23514.*sobe tentativas em exatamente 1/s);
    assert.equal(status(id), 'pendente/ler_brain/0/0');
    reservar(id);
    doWorker(`UPDATE core.strategy_plan_runs SET lease_until = now() - interval '1 minute' WHERE id = '${id}' RETURNING id;`);
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET status = 'rodando', lease_until = now() + interval '1 minute' WHERE id = '${id}'`)) ?? '', /23514.*sobe tentativas em exatamente 1/s);
    assert.equal(status(id), 'rodando/ler_brain/0/1');
  });

  it('transições inválidas do worker são negadas', () => {
    const id = pedir(novoPlano());
    for (const alvo of ["status = 'concluida', etapa = 'fim'", "status = 'falhou', erro_codigo = 'interno'", "status = 'cancelada'"]) {
      assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET ${alvo} WHERE id = '${id}'`)) ?? '', /23514.*transição inválida/s, alvo);
    }
    reservar(id);
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${id}'`)) ?? '', /23514.*transição inválida/s);
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET rodada = 0, tentativas = 0, falhas = 0 WHERE id = '${id}'`)) ?? '', /23514.*só crescem/s);
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET status = 'concluida' WHERE id = '${id}'`)) ?? '', /23514.*concluida_sem_erro/s);
  });

  it('o worker não muda o pedido, o plano nem quem pediu', () => {
    const id = pedir(novoPlano());
    for (const coluna of ['pedido', 'plan_id', 'requested_by', 'agent_run_id', 'kind', 'created_at']) {
      assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET ${coluna} = ${coluna} WHERE id = '${id}'`)) ?? '', /42501.*permission denied/s, coluna);
    }
  });

  it('pessoa só cancela: pendente e rodando viram cancelada; o resto do registro é intocável', () => {
    const pendente = pedir(novoPlano());
    comoApp(ids.orgA, '*', ids.operador, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${pendente}'`);
    assert.equal(status(pendente), 'cancelada/ler_brain/0/0');

    const rodando = pedir(novoPlano(), ids.admin);
    reservar(rodando);
    comoApp(ids.orgA, '*', ids.admin, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${rodando}'`);
    assert.equal(status(rodando), 'cancelada/ler_brain/0/1');
    assert.match(recusa(() => doWorker(`UPDATE core.strategy_plan_runs SET status = 'concluida', etapa = 'fim' WHERE id = '${rodando}'`)) ?? '', /23514.*estado final/s);

    const outra = pedir(novoPlano());
    for (const sql of [
      "SET etapa = 'fim'",
      "SET status = 'concluida'",
      "SET status = 'rodando'",
      "SET pedido = '{}'::jsonb",
      "SET lease_until = now()",
      "SET erro_codigo = 'interno'",
    ]) {
      assert.match(recusa(() => comoApp(ids.orgA, '*', ids.operador, `UPDATE core.strategy_plan_runs ${sql} WHERE id = '${outra}'`)) ?? '', /42501|23001|23514/, sql);
    }
  });

  it('viewer e não membro não cancelam; app não apaga nem trunca', () => {
    const id = pedir(novoPlano());
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.leitor, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${id}'`)) ?? '', /42501/);
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.naoMembro, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${id}'`)) ?? '', /42501/);
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, `DELETE FROM core.strategy_plan_runs WHERE id = '${id}'`)) ?? '', /42501.*permission denied/s);
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, 'TRUNCATE core.strategy_plan_runs')) ?? '', /42501.*permission denied/s);
    assert.match(recusa(() => doWorker(`DELETE FROM core.strategy_plan_runs WHERE id = '${id}'`)) ?? '', /42501.*permission denied/s);
    assert.match(recusa(() => dono(`DELETE FROM core.strategy_plan_runs WHERE id = '${id}'`)) ?? '', /23001.*não se apaga/s);
    assert.equal(status(id), 'pendente/ler_brain/0/0');
  });

  it('o dono tampouco edita o pedido ou o status fora dos caminhos previstos', () => {
    const id = pedir(novoPlano());
    assert.match(recusa(() => dono(`UPDATE core.strategy_plan_runs SET status = 'concluida', etapa = 'fim' WHERE id = '${id}'`)) ?? '', /23001.*imutável/s);
    assert.match(recusa(() => dono(`UPDATE core.strategy_plan_runs SET pedido = '{"instrucao":"zzz"}'::jsonb WHERE id = '${id}'`)) ?? '', /23001.*imutável/s);
  });

  it('isolamento: outra organização não lê nem cria execução; recorte por cliente esconde as do cliente fora do escopo', () => {
    const plano = novoPlano();
    const id = pedir(plano);
    assert.equal(comoApp(ids.orgB, '*', ids.donoB, `SELECT count(*) FROM core.strategy_plan_runs WHERE id = '${id}'`), '0');
    assert.equal(comoApp(ids.orgB, ids.cliA, ids.donoB, `SELECT count(*) FROM core.strategy_plan_runs WHERE id = '${id}'`), '0');
    assert.match(recusa(() => comoApp(ids.orgB, '*', ids.donoB, sqlExecucao({ organizacao: ids.orgA, plano, por: ids.donoB }))) ?? '', /42501/);
    assert.match(recusa(() => comoApp(ids.orgB, '*', ids.donoB, sqlExecucao({ organizacao: ids.orgB, cli: ids.cliA, plano, por: ids.donoB }))) ?? '', /42501|23503/);
    assert.match(recusa(() => comoApp(ids.orgB, '*', ids.donoB, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${id}' RETURNING id;`)) ?? 'sem erro', /sem erro|42501/);
    assert.equal(status(id), 'pendente/ler_brain/0/0');

    assert.equal(comoApp(ids.orgA, ids.cliA2, ids.recortado, `SELECT count(*) FROM core.strategy_plan_runs WHERE id = '${id}'`), '0');
    assert.equal(comoApp(ids.orgA, ids.cliA, ids.operador, `SELECT count(*) FROM core.strategy_plan_runs WHERE id = '${id}'`), '1');
    assert.match(recusa(() => comoApp(ids.orgA, ids.cliA2, ids.recortado, sqlExecucao({ plano, por: ids.recortado }))) ?? '', /42501/);
    assert.equal(comoApp(ids.orgA, ids.cliA2, ids.recortado, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${id}' RETURNING id;`), '');
    assert.equal(status(id), 'pendente/ler_brain/0/0');
    assert.equal(doWorker(`SELECT count(*) FROM core.strategy_plan_runs WHERE id = '${id}'`), '1');
  });

  it('redação de uma versão troca o pedido de todas as execuções do plano, inclusive as finais; outro plano não muda', () => {
    const plano = novoPlano();
    const outro = novoPlano();
    const versao = comoApp(
      ids.orgA,
      '*',
      ids.operador,
      `INSERT INTO core.strategy_plan_versions (organization_id, client_id, plan_id, content, schema_version, author_kind, author_user_id)
       VALUES ('${ids.orgA}', '${ids.cliA}', '${plano}', '{"a":1}'::jsonb, 1, 'usuario', '${ids.operador}') RETURNING id;`,
    );
    const final = pedir(plano, ids.operador, { tipo: 'ajustar', pedido: '{"instrucao":"texto livre da pessoa"}' });
    reservar(final);
    doWorker(`UPDATE core.strategy_plan_runs SET status = 'falhou', erro_codigo = 'ia_falha' WHERE id = '${final}' RETURNING id;`);
    const ativa = pedir(plano, ids.admin);
    const doOutro = pedir(outro);
    doWorker(`SELECT core.redigir_plano('${versao}', 'pedido do titular');`);
    for (const id of [final, ativa]) {
      assert.equal(dono(`SELECT pedido::text FROM core.strategy_plan_runs WHERE id = '${id}'`), '{"redigido": true}');
    }
    assert.match(dono(`SELECT pedido->>'objetivo' FROM core.strategy_plan_runs WHERE id = '${doOutro}'`), /Gerar leads/);
    assert.equal(status(final), 'falhou/ler_brain/0/1');
    assert.match(recusa(() => doWorker(`SELECT core.redigir_plano('${randomUUID()}', 'sem versão')`)) ?? '', /versão inexistente/);
  });

  it('o expurgo do cliente leva as execuções', () => {
    const cli = cliente(ids.orgA, 'cli-expurgo');
    const plano = novoPlano(cli);
    const id = pedir(plano, ids.operador, { cli });
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_runs WHERE id = '${id}'`), '1');
    dono(`DELETE FROM core.clients WHERE id = '${cli}'`);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_runs WHERE id = '${id}'`), '0');
  });

  it('strategy_runs_pendentes: só o worker executa; devolve só identificadores de pendentes e de lease vencido, sem finais nem cancelados', () => {
    const pendente = pedir(novoPlano());
    const vencida = pedir(novoPlano());
    reservar(vencida);
    doWorker(`UPDATE core.strategy_plan_runs SET lease_until = now() - interval '1 minute' WHERE id = '${vencida}' RETURNING id;`);
    const emDia = pedir(novoPlano());
    reservar(emDia);
    const cancelada = pedir(novoPlano());
    comoApp(ids.orgA, '*', ids.operador, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${cancelada}'`);
    const concluida = pedir(novoPlano());
    reservar(concluida);
    doWorker(`UPDATE core.strategy_plan_runs SET status = 'concluida', etapa = 'fim' WHERE id = '${concluida}' RETURNING id;`);

    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, 'SELECT count(*) FROM core.strategy_runs_pendentes(10)')) ?? '', /42501.*permission denied/s);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', 'SELECT count(*) FROM core.strategy_runs_pendentes(10)')) ?? '', /42501.*permission denied/s);
    const linhas = comoWorker(ids.orgA, '*', '', `SELECT string_agg(organization_id || ',' || client_id || ',' || id, ' ' ORDER BY ordinality) FROM core.strategy_runs_pendentes(50) WITH ORDINALITY`).split(' ');
    const achadas = new Set(linhas.map((linha) => linha.split(',')[2]));
    assert.ok(achadas.has(pendente) && achadas.has(vencida));
    for (const fora of [emDia, cancelada, concluida]) assert.ok(!achadas.has(fora), fora);
    assert.deepEqual(linhas.find((linha) => linha.endsWith(pendente)).split(',').slice(0, 2), [ids.orgA, ids.cliA]);
    assert.ok(linhas.findIndex((l) => l.endsWith(pendente)) < linhas.findIndex((l) => l.endsWith(vencida)), 'mais antigas primeiro');
    assert.equal(comoWorker(ids.orgA, '*', '', 'SELECT count(*) FROM core.strategy_runs_pendentes(0)'), '0');
    assert.ok(Number(comoWorker(ids.orgA, '*', '', 'SELECT count(*) FROM core.strategy_runs_pendentes(1000)')) <= 50);
    assert.equal(comoWorker(ids.orgA, '*', '', 'SELECT count(*) FROM core.strategy_runs_pendentes(1)'), '1');
  });

  it('SET NULL de requested_by quando a pessoa é apagada não é bloqueado', () => {
    const pessoa = usuario('efemero');
    membro(ids.orgA, pessoa, 'operator');
    const id = pedir(novoPlano(), pessoa);
    dono(`DELETE FROM core.members WHERE user_id = '${pessoa}'`);
    dono(`DELETE FROM core.users WHERE id = '${pessoa}'`);
    assert.equal(dono(`SELECT coalesce(requested_by::text, 'nulo') FROM core.strategy_plan_runs WHERE id = '${id}'`), 'nulo');
  });
});

function endereco() {
  try {
    const porta = execFileSync('docker', ['port', CONTAINER, '5432/tcp'], { encoding: 'utf8' }).split('\n')[0].trim();
    return porta.replace(/^0\.0\.0\.0|^\[::\]/, '127.0.0.1');
  } catch {
    return null;
  }
}

describe('Strategy Plan, repositório e serviço contra Postgres real', { concurrency: false, skip: pular }, () => {
  const criadas = { clientes: [], orgs: [], usuarios: [] };

  after(() => {
    for (const id of criadas.clientes) dono(`DELETE FROM core.member_clients WHERE client_id = '${id}'`);
    for (const id of criadas.clientes) dono(`DELETE FROM core.clients WHERE id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.members WHERE user_id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.users WHERE id = '${id}'`);
    for (const id of criadas.orgs) dono(`DELETE FROM core.organizations WHERE id = '${id}'`);
  });

  it('cenário completo: plano, execução, versão com referências, parecer e gate pelo worker, aplicar e autorizar', async () => {
    const host = endereco();
    assert.ok(host, `a porta 5432 do container ${CONTAINER} precisa estar publicada para o cenário do repositório`);
    const org = (nome) => {
      const id = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Repo ${nome} ${sufixo}', 'repo-${nome}-${sufixo}', 'agency') RETURNING id`);
      criadas.orgs.push(id);
      return id;
    };
    const cliente = (organizacao, nome) => {
      const id = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${organizacao}', '${nome} ${sufixo}', 'leads') RETURNING id`);
      criadas.clientes.push(id);
      return id;
    };
    const pessoa = (organizacao, nome, papel) => {
      const id = dono(`INSERT INTO core.users (email, name) VALUES ('repo-${nome}-${sufixo}@tria.local', '${nome}') RETURNING id`);
      criadas.usuarios.push(id);
      dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${organizacao}', '${id}', '${papel}')`);
      return id;
    };
    const orgA = org('a');
    const orgB = org('b');
    const cenario = {
      orgA,
      orgB,
      cliA: cliente(orgA, 'a'),
      cliA2: cliente(orgA, 'a2'),
      cliB: cliente(orgB, 'b'),
      owner: pessoa(orgA, 'owner', 'owner'),
      operator: pessoa(orgA, 'operator', 'operator'),
      viewer: pessoa(orgA, 'viewer', 'viewer'),
      donoB: pessoa(orgB, 'dono-b', 'owner'),
    };
    const banco = (usuario, senha) => `postgres://${usuario}:${encodeURIComponent(senha)}@${host}/tria`;
    const { stdout } = await executar(process.execPath, ['--experimental-strip-types', '--no-warnings', 'tests/apoio/estrategiaRepositorioCenario.mjs'], {
      env: {
        ...process.env,
        DATABASE_URL: banco('orla_app', variavel('APP_DB_PASSWORD')),
        DATABASE_URL_WORKER: banco('orla_worker', variavel('WORKER_DB_PASSWORD')),
        STRATEGY_CENARIO: JSON.stringify(cenario),
      },
      timeout: 120_000,
    });
    assert.match(stdout, /cenario ok/);
  });
});
