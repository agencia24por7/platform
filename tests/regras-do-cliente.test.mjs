import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';

const CONTAINER = process.env.TRIA_TEST_PG ?? 'orla-postgres';
const sufixo = randomBytes(4).toString('hex');
const executar = promisify(execFile);

const variavel = (nome) =>
  process.env[nome] ??
  readFileSync('.env', 'utf8')
    .split('\n')
    .find((linha) => linha.startsWith(`${nome}=`))
    .slice(nome.length + 1);

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
  '-qtAc',
  sql,
];

const psql = (usuario, senha, sql) => execFileSync('docker', argumentos(usuario, senha, sql), { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const ultimaLinha = (texto) => texto.split('\n').at(-1).trim();

const dono = (sql) => ultimaLinha(psql('postgres', null, sql));

const ids = {};
const contexto = (organizacao, clientes, usuario = ids.usuario) =>
  `SET app.organization_id = '${organizacao}'; SET app.client_ids = '${clientes}'; SET app.user_id = '${usuario ?? ''}'; `;
const comoApp = (organizacao, clientes, sql, usuario) => ultimaLinha(psql('orla_app', variavel('APP_DB_PASSWORD'), contexto(organizacao, clientes, usuario) + sql));
const comoWorker = (organizacao, clientes, sql, usuario) => ultimaLinha(psql('orla_worker', variavel('WORKER_DB_PASSWORD'), contexto(organizacao, clientes, usuario) + sql));

const recusa = (fn) => {
  try {
    fn();
    return null;
  } catch (falha) {
    return String(falha.stderr ?? falha.message);
  }
};

const aspas = (valor) => (valor === null || valor === undefined ? 'NULL' : `'${String(valor).replaceAll("'", "''")}'`);

const limite = (valor, unidade = 'brl_centavos') => JSON.stringify({ valor, unidade });

function sqlDecisao({ org, cli, categoria = 'governanca', natureza = 'regra', origem = 'agencia', status = 'vigente', chave, escopo = 'cliente', titulo = 'Titulo', texto, valor, definicao, supersede, numero, agente, idempotencia, decididoPor = origem === 'agente' ? undefined : ids.usuario, contextoTexto, evidencia, emNomeDe, inicio, fim, link, execucao, criadoEm }) {
  const corpo = texto === undefined && natureza === 'regra' ? 'Texto normativo' : texto;
  const colunas = {
    organization_id: org,
    client_id: cli,
    category: categoria,
    nature: natureza,
    origin: origem,
    status,
    key: chave,
    scope: escopo,
    title: titulo,
    context: contextoTexto,
    body: corpo,
    value: valor,
    definition_key: definicao,
    definition_version: definicao ? 1 : undefined,
    supersedes_id: supersede,
    number: numero,
    agent_id: agente,
    idempotency_key: idempotencia,
    decided_by: decididoPor,
    evidence: evidencia,
    on_behalf_of: emNomeDe,
    valid_from: inicio,
    valid_until: fim,
    via_link_id: link,
    agent_run_id: execucao,
    created_at: criadoEm,
  };
  const presentes = Object.entries(colunas).filter(([, v]) => v !== undefined);
  const nomes = presentes.map(([k]) => k).join(', ');
  const valores = presentes.map(([k, v]) => (k === 'value' ? `${aspas(v)}::jsonb` : k === 'definition_version' ? v : aspas(v))).join(', ');
  return `INSERT INTO core.client_decisions (${nomes}) VALUES (${valores}) RETURNING id`;
}

const eventoApp = (org, cli, decisao, tipo, motivo, { ator = ids.usuario, tipoDeAtor = 'usuario' } = {}) =>
  `INSERT INTO core.client_decision_events (organization_id, client_id, decision_id, type, reason, actor_kind, actor_user_id)
   VALUES ('${org}', '${cli}', '${decisao}', '${tipo}', ${aspas(motivo ?? null)}, '${tipoDeAtor}', ${aspas(ator ?? null)})`;

const criadas = { clientes: [], orgs: [], usuarios: [] };

function organizacao(nome) {
  const org = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Regras ${nome} ${sufixo}', 'regras-${nome}-${sufixo}', 'agency') RETURNING id`);
  criadas.orgs.push(org);
  return org;
}

function cliente(org, nome) {
  const id = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome} ${sufixo}', 'leads') RETURNING id`);
  criadas.clientes.push(id);
  return id;
}

const novoCliente = () => cliente(ids.orgA, `cli-${randomBytes(3).toString('hex')}`);
const statusDe = (id) => dono(`SELECT status FROM core.client_decisions WHERE id = '${id}'`);
const doApp = (sql) => comoApp(ids.orgA, '*', sql);
const doWorker = (sql) => comoWorker(ids.orgA, '*', sql);
const membro = (org, usuario) =>
  dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${org}', '${usuario}', 'owner') ON CONFLICT (organization_id, user_id) DO NOTHING`);

describe('regras, limites e decisões do cliente (migração 0141, ADR 0051)', { concurrency: false }, () => {
  before(() => {
    ids.usuario = dono(`INSERT INTO core.users (email, name) VALUES ('regras-pessoa-${sufixo}@tria.local', 'Pessoa da agência') RETURNING id`);
    criadas.usuarios.push(ids.usuario);
    ids.outroUsuario = dono(`INSERT INTO core.users (email, name) VALUES ('regras-outra-${sufixo}@tria.local', 'Outra pessoa') RETURNING id`);
    criadas.usuarios.push(ids.outroUsuario);
    ids.orgA = organizacao('a');
    ids.orgB = organizacao('b');
    ids.cliA = cliente(ids.orgA, 'cliente-a');
    ids.cliA2 = cliente(ids.orgA, 'cliente-a2');
    ids.cliB = cliente(ids.orgB, 'cliente-b');
    ids.naoMembro = dono(`INSERT INTO core.users (email, name) VALUES ('regras-fora-${sufixo}@tria.local', 'Fora da organização') RETURNING id`);
    criadas.usuarios.push(ids.naoMembro);
    for (const org of [ids.orgA, ids.orgB]) membro(org, ids.usuario);
    membro(ids.orgA, ids.outroUsuario);
  });

  after(() => {
    for (const id of criadas.clientes) dono(`DELETE FROM core.clients WHERE id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.members WHERE user_id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.users WHERE id = '${id}'`);
    for (const id of criadas.orgs) dono(`DELETE FROM core.limit_definitions WHERE organization_id = '${id}'`);
    for (const id of criadas.orgs) dono(`DELETE FROM core.organizations WHERE id = '${id}'`);
  });

  describe('definições de limite', () => {
    it('traz a carga inicial como dado e o app só lê', () => {
      const chaves = doApp("SELECT string_agg(key, ',' ORDER BY key) FROM core.limit_definitions WHERE key !~ '[0-9a-f]{8}$'");
      assert.equal(
        chaves,
        'eficiencia.cac_maximo,eficiencia.cpa_maximo,eficiencia.cpl_maximo,eficiencia.roas_minimo,investimento.piso_mensal,investimento.teto_diario,investimento.teto_mensal',
      );
      assert.equal(doApp("SELECT string_agg(key, ',' ORDER BY key) FROM core.limit_definitions WHERE essential"), 'eficiencia.cac_maximo,investimento.teto_mensal');
      assert.equal(
        doApp("SELECT unit||'/'||period||'/'||direction||'/'||measure FROM core.limit_definitions WHERE key = 'investimento.teto_mensal'"),
        'brl_centavos/mes/teto/gasto',
      );
      assert.equal(doApp("SELECT unit||'/'||direction||'/'||measure FROM core.limit_definitions WHERE key = 'eficiencia.roas_minimo'"), 'razao/piso/retorno');
      for (const sql of [
        "INSERT INTO core.limit_definitions (key, name, category, measure, unit, period, direction, min_value, max_value) VALUES ('investimento.x', 'x', 'investimento', 'gasto', 'brl_centavos', 'mes', 'teto', '0', '1')",
        "UPDATE core.limit_definitions SET active = false WHERE key = 'investimento.teto_mensal'",
        "DELETE FROM core.limit_definitions WHERE key = 'investimento.teto_mensal'",
      ]) {
        assert.match(recusa(() => doApp(sql)) ?? '', /permission denied/, sql);
      }
    });

    it('o catálogo global não depende de organizations: TRUNCATE CASCADE leva decisões, não as definições', () => {
      assert.equal(dono(`SELECT count(*) FROM pg_constraint WHERE conrelid = 'core.limit_definitions'::regclass AND contype = 'f'`), '0');
      const cli = novoCliente();
      doApp(sqlDecisao({ org: ids.orgA, cli, categoria: 'investimento', natureza: 'limite', chave: 'investimento.teto_mensal', definicao: 'investimento.teto_mensal', valor: limite('100') }));
      const globais = dono(`SELECT count(*) FROM core.limit_definitions WHERE organization_id IS NULL`);
      assert.ok(Number(globais) >= 7);
      const dentroDoTruncate = dono(
        `BEGIN; TRUNCATE core.organizations CASCADE;
         SELECT (SELECT count(*) FROM core.limit_definitions WHERE organization_id IS NULL) || '/' || (SELECT count(*) FROM core.client_decisions)
                || '/' || (SELECT count(*) FROM core.client_decision_events) || '/' || (SELECT count(*) FROM core.regras_migracao_contexto);
         ROLLBACK;`,
      );
      assert.equal(dentroDoTruncate, `${globais}/0/0/0`);
      assert.match(
        recusa(() => dono(`INSERT INTO core.limit_definitions (key, organization_id, name, category, measure, unit, period, direction, min_value, max_value)
          VALUES ('investimento.org_fantasma${sufixo}', gen_random_uuid(), 'x', 'investimento', 'gasto', 'brl_centavos', 'mes', 'teto', '0', '1')`)) ?? '',
        /organização da definição de limite inexistente/,
      );
    });

    it('não se edita conteúdo (só active); versão nova é INSERT', () => {
      const chave = `investimento.t${sufixo}`;
      dono(`INSERT INTO core.limit_definitions (key, name, category, measure, unit, period, direction, min_value, max_value)
            VALUES ('${chave}', 'Temporario', 'investimento', 'gasto', 'brl_centavos', 'mes', 'teto', '0', '100')`);
      for (const coluna of ["unit = 'razao'", "max_value = '999'", "name = 'outro'"]) {
        assert.match(recusa(() => dono(`UPDATE core.limit_definitions SET ${coluna} WHERE key = '${chave}'`)) ?? '', /não se edita/, coluna);
      }
      dono(`UPDATE core.limit_definitions SET active = false WHERE key = '${chave}'`);
      assert.equal(dono(`SELECT active FROM core.limit_definitions WHERE key = '${chave}'`), 'f');
      dono(`INSERT INTO core.limit_definitions (key, version, name, category, measure, unit, period, direction, min_value, max_value)
            VALUES ('${chave}', 2, 'Temporario v2', 'investimento', 'gasto', 'brl_centavos', 'mes', 'teto', '0', '500')`);
      assert.equal(dono(`SELECT count(*) FROM core.limit_definitions WHERE key = '${chave}'`), '2');
      assert.match(
        recusa(() => dono(`INSERT INTO core.limit_definitions (key, name, category, measure, unit, period, direction, min_value, max_value)
          VALUES ('eficiencia.fora${sufixo}', 'x', 'investimento', 'gasto', 'brl_centavos', 'mes', 'teto', '0', '1')`)) ?? '',
        /limit_definitions_chave/,
      );
      assert.match(
        recusa(() => dono(`INSERT INTO core.limit_definitions (key, name, category, measure, unit, period, direction, min_value, max_value)
          VALUES ('investimento.faixa${sufixo}', 'x', 'investimento', 'gasto', 'brl_centavos', 'mes', 'teto', '10', '1')`)) ?? '',
        /limit_definitions_faixa/,
      );
    });
  });

  describe('isolamento e recorte', () => {
    it('uma organização não lê nem escreve na outra', () => {
      const id = doApp(sqlDecisao({ org: ids.orgA, cli: ids.cliA, chave: 'governanca.aprovacao', titulo: 'Segredo da A' }));
      assert.match(id, /^[0-9a-f-]{36}$/);

      assert.equal(comoApp(ids.orgB, '*', 'SELECT count(*) FROM core.client_decisions'), '0');
      assert.equal(comoApp(ids.orgB, '*', 'SELECT count(*) FROM core.client_decision_events'), '0');
      assert.equal(comoApp(ids.orgA, '*', `SELECT count(*) FROM core.client_decisions WHERE id = '${id}'`), '1');

      const cenarios = {
        'B grava na A com a organização da A': () => comoApp(ids.orgB, '*', sqlDecisao({ org: ids.orgA, cli: ids.cliA, chave: 'governanca.x1' })),
        'B grava no cliente da A com a própria organização': () => comoApp(ids.orgB, '*', sqlDecisao({ org: ids.orgB, cli: ids.cliA, chave: 'governanca.x2' })),
        'A grava no cliente da B': () => comoApp(ids.orgA, '*', sqlDecisao({ org: ids.orgA, cli: ids.cliB, chave: 'governanca.x3' })),
        'B forja evento na decisão da A': () => comoApp(ids.orgB, '*', eventoApp(ids.orgB, ids.cliB, id, 'revogada', 'forjado')),
      };
      for (const [nome, executar] of Object.entries(cenarios)) {
        assert.ok(recusa(executar), `${nome}: devia ter sido recusado`);
      }
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE title IN ('Titulo') AND organization_id <> client_id AND key IN ('governanca.x1','governanca.x2','governanca.x3')`), '0');
    });

    it('recorte de clientes: lista vazia nega, cliente fora do recorte nega, "*" é explícito', () => {
      const id = doApp(sqlDecisao({ org: ids.orgA, cli: ids.cliA, chave: 'governanca.recorte' }));
      assert.equal(comoApp(ids.orgA, '', 'SELECT count(*) FROM core.client_decisions'), '0');
      assert.equal(comoApp(ids.orgA, 'nenhum', 'SELECT count(*) FROM core.client_decisions'), '0');
      assert.equal(comoApp(ids.orgA, ids.cliA2, `SELECT count(*) FROM core.client_decisions WHERE id = '${id}'`), '0');
      assert.equal(comoApp(ids.orgA, ids.cliA, `SELECT count(*) FROM core.client_decisions WHERE id = '${id}'`), '1');
      assert.equal(comoApp(ids.orgA, `${ids.cliA2},${ids.cliA}`, `SELECT count(*) FROM core.client_decisions WHERE id = '${id}'`), '1');

      assert.match(recusa(() => comoApp(ids.orgA, '', sqlDecisao({ org: ids.orgA, cli: ids.cliA, chave: 'governanca.r1' }))) ?? '', /row-level security/);
      assert.match(recusa(() => comoApp(ids.orgA, ids.cliA2, sqlDecisao({ org: ids.orgA, cli: ids.cliA, chave: 'governanca.r2' }))) ?? '', /row-level security/);
      assert.match(recusa(() => comoApp(ids.orgA, '', eventoApp(ids.orgA, ids.cliA, id, 'revogada', 'sem recorte'))) ?? '', /row-level security|violates/);
      assert.equal(statusDe(id), 'vigente');
      assert.equal(comoWorker(ids.orgA, '', 'SELECT count(*) FROM core.client_decisions'), '0');
    });
  });

  describe('imutabilidade', () => {
    it('UPDATE, DELETE e TRUNCATE são negados ao app; os gatilhos negam até o dono', () => {
      const cli = novoCliente();
      const id = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.imutavel' }));
      const evento = dono(`SELECT id FROM core.client_decision_events WHERE decision_id = '${id}'`);

      for (const sql of [
        `UPDATE core.client_decisions SET title = 'editado' WHERE id = '${id}'`,
        `UPDATE core.client_decisions SET status = 'revogada' WHERE id = '${id}'`,
        `DELETE FROM core.client_decisions WHERE id = '${id}'`,
        'TRUNCATE core.client_decisions',
        `UPDATE core.client_decision_events SET reason = 'x' WHERE id = '${evento}'`,
        `DELETE FROM core.client_decision_events WHERE id = '${evento}'`,
        'TRUNCATE core.client_decision_events',
      ]) {
        assert.match(recusa(() => doApp(sql)) ?? '', /permission denied/, `app: ${sql}`);
        assert.match(recusa(() => doWorker(sql)) ?? '', /permission denied/, `worker: ${sql}`);
      }

      for (const sql of [
        `UPDATE core.client_decisions SET title = 'editado' WHERE id = '${id}'`,
        `UPDATE core.client_decisions SET body = 'editado' WHERE id = '${id}'`,
        `UPDATE core.client_decisions SET status = 'revogada' WHERE id = '${id}'`,
        `UPDATE core.client_decisions SET nature = 'decisao' WHERE id = '${id}'`,
        `DELETE FROM core.client_decisions WHERE id = '${id}'`,
        `UPDATE core.client_decision_events SET reason = 'x' WHERE id = '${evento}'`,
        `UPDATE core.client_decision_events SET type = 'rejeitada' WHERE id = '${evento}'`,
        `DELETE FROM core.client_decision_events WHERE id = '${evento}'`,
      ]) {
        assert.match(recusa(() => dono(sql)) ?? '', /imutável|não se apagam|só de acréscimo/, `gatilho: ${sql}`);
      }

      assert.match(recusa(() => doApp(`SELECT set_config('orla.decisao_mutacao', 'evento', false); UPDATE core.client_decisions SET status = 'revogada'`)) ?? '', /permission denied/);
      assert.equal(dono(`SELECT status||'/'||title FROM core.client_decisions WHERE id = '${id}'`), 'vigente/Titulo');
    });

    it('usuário apagado vira NULL em decided_by e no evento sem quebrar a imutabilidade', () => {
      const cli = novoCliente();
      const usuario = dono(`INSERT INTO core.users (email, name) VALUES ('regras-${sufixo}@tria.local', 'Quem decidiu') RETURNING id`);
      membro(ids.orgA, usuario);
      const id = comoApp(ids.orgA, '*', sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.autor', decididoPor: usuario }), usuario);
      assert.equal(dono(`SELECT decided_by FROM core.client_decisions WHERE id = '${id}'`), usuario);
      dono(`DELETE FROM core.members WHERE user_id = '${usuario}'`);
      dono(`DELETE FROM core.users WHERE id = '${usuario}'`);
      assert.equal(dono(`SELECT coalesce(decided_by::text, 'nulo') FROM core.client_decisions WHERE id = '${id}'`), 'nulo');
      assert.equal(dono(`SELECT coalesce(actor_user_id::text, 'nulo') FROM core.client_decision_events WHERE decision_id = '${id}'`), 'nulo');
    });
  });

  describe('vigência e supersessão', () => {
    it('o índice único barra a segunda vigente por cliente, chave e escopo', () => {
      const cli = novoCliente();
      doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.unica', titulo: 'Primeira' }));
      assert.match(recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.unica', titulo: 'Segunda' }))) ?? '', /client_decisions_uma_vigente|duplicate key/);
      doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.unica', escopo: 'plataforma:meta', titulo: 'Outro escopo' }));
      doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.outra', titulo: 'Outra chave' }));
      doApp(sqlDecisao({ org: ids.orgA, cli: ids.cliA2, chave: 'governanca.unica', titulo: 'Outro cliente' }));
      doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.unica', status: 'proposta', titulo: 'Proposta convive' }));
      doApp(sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', titulo: 'Decisão 1' }));
      doApp(sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', titulo: 'Decisão 2' }));
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}' AND status = 'vigente' AND key = 'governanca.unica' AND scope = 'cliente'`), '1');
    });

    it('a nova vigente supera a anterior na mesma transação', () => {
      const cli = novoCliente();
      const a = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.alterar', titulo: 'v1' }));
      const b = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.alterar', titulo: 'v2', supersede: a }));
      assert.equal(statusDe(a), 'superada');
      assert.equal(statusDe(b), 'vigente');
      assert.equal(dono(`SELECT string_agg(type, ',' ORDER BY occurred_at, type) FROM core.client_decision_events WHERE decision_id = '${a}'`), 'efetivada,superada');
      assert.equal(dono(`SELECT successor_id FROM core.client_decision_events WHERE decision_id = '${a}' AND type = 'superada'`), b);

      assert.match(recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.alterar', titulo: 'v3', supersede: a }))) ?? '', /só decisão vigente pode ser superada/);
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}'`), '2');

      assert.match(recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.outra', titulo: 'x', supersede: b }))) ?? '', /mesma natureza, chave e escopo/);
      assert.match(recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli: ids.cliA2, chave: 'governanca.alterar', titulo: 'x', supersede: b }))) ?? '', /não existe neste cliente/);
      assert.equal(statusDe(b), 'vigente');
    });

    it('a transação inteira some se a nova falha: a anterior continua vigente', () => {
      const cli = novoCliente();
      const a = doApp(sqlDecisao({ org: ids.orgA, cli, categoria: 'investimento', natureza: 'limite', chave: 'investimento.teto_mensal', definicao: 'investimento.teto_mensal', valor: limite('100000'), titulo: 'v1' }));
      assert.ok(recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, categoria: 'investimento', natureza: 'limite', chave: 'investimento.teto_mensal', definicao: 'investimento.teto_mensal', valor: limite('999999999999999'), titulo: 'v2', supersede: a }))));
      assert.equal(statusDe(a), 'vigente');
    });

    it('duas supersessões concorrentes da mesma vigente: só uma passa', async () => {
      const cli = novoCliente();
      const a = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.corrida', titulo: 'v1' }));
      const tentar = (titulo) => {
        const sql = `${contexto(ids.orgA, '*')} BEGIN; ${sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.corrida', titulo, supersede: a })}; SELECT pg_sleep(1); COMMIT;`;
        return executar('docker', argumentos('orla_app', variavel('APP_DB_PASSWORD'), sql)).then(
          () => 'ok',
          (falha) => `falhou: ${falha.stderr}`,
        );
      };
      const resultados = await Promise.all([tentar('v2a'), tentar('v2b')]);
      assert.equal(resultados.filter((r) => r === 'ok').length, 1, JSON.stringify(resultados));
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}' AND status = 'vigente'`), '1');
      assert.equal(statusDe(a), 'superada');
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}'`), '2');
    });

    it('sem a anterior declarada, a corrida de duas vigentes é barrada pelo índice único', async () => {
      const cli = novoCliente();
      const tentar = (titulo) => {
        const sql = `${contexto(ids.orgA, '*')} BEGIN; ${sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.corrida2', titulo })}; SELECT pg_sleep(1); COMMIT;`;
        return executar('docker', argumentos('orla_app', variavel('APP_DB_PASSWORD'), sql)).then(
          () => 'ok',
          (falha) => `falhou: ${falha.stderr}`,
        );
      };
      const resultados = await Promise.all([tentar('a'), tentar('b')]);
      assert.equal(resultados.filter((r) => r === 'ok').length, 1, JSON.stringify(resultados));
      assert.match(resultados.find((r) => r !== 'ok'), /client_decisions_uma_vigente|duplicate key/);
    });
  });

  describe('número sequencial por cliente', () => {
    it('é gerado pelo banco, ignora o enviado, não tem buraco e recomeça por cliente', () => {
      const cli = novoCliente();
      const outro = novoCliente();
      for (let i = 1; i <= 3; i++) doApp(sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', titulo: `d${i}`, numero: 99 }));
      assert.ok(recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, natureza: 'regra', chave: 'governanca.bad', status: 'revogada' }))));
      doApp(sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', titulo: 'd4' }));
      doApp(sqlDecisao({ org: ids.orgA, cli: outro, natureza: 'decisao', categoria: 'processo', titulo: 'o1' }));
      assert.equal(dono(`SELECT string_agg(number::text, ',' ORDER BY number) FROM core.client_decisions WHERE client_id = '${cli}'`), '1,2,3,4');
      assert.equal(dono(`SELECT string_agg(number::text, ',') FROM core.client_decisions WHERE client_id = '${outro}'`), '1');
    });

    it('inserções concorrentes no mesmo cliente não repetem nem pulam número', async () => {
      const cli = novoCliente();
      const inserir = (i) =>
        executar('docker', argumentos('orla_app', variavel('APP_DB_PASSWORD'), contexto(ids.orgA, '*') + sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', titulo: `c${i}` })));
      await Promise.all([1, 2, 3, 4, 5, 6].map(inserir));
      assert.equal(dono(`SELECT string_agg(number::text, ',' ORDER BY number) FROM core.client_decisions WHERE client_id = '${cli}'`), '1,2,3,4,5,6');
    });
  });

  describe('valor do limite contra a definição', () => {
    const teto = (valor, extras = {}) =>
      sqlDecisao({ org: ids.orgA, cli: novoCliente(), categoria: 'investimento', natureza: 'limite', chave: 'investimento.teto_mensal', definicao: 'investimento.teto_mensal', valor, ...extras });

    it('aceita valor dentro da faixa e na unidade certa', () => {
      const id = doApp(teto(limite('5000000')));
      assert.equal(dono(`SELECT value->>'valor' FROM core.client_decisions WHERE id = '${id}'`), '5000000');
      assert.equal(dono(`SELECT definition_key||'@'||definition_version FROM core.client_decisions WHERE id = '${id}'`), 'investimento.teto_mensal@1');
      const roas = doApp(sqlDecisao({ org: ids.orgA, cli: novoCliente(), categoria: 'eficiencia', natureza: 'limite', chave: 'eficiencia.roas_minimo', definicao: 'eficiencia.roas_minimo', valor: limite('3.5', 'razao') }));
      assert.match(roas, /^[0-9a-f-]{36}$/);
      doApp(teto(limite('0')));
      doApp(teto(limite('100000000000')));
      doApp(teto(limite('2000000'), { escopo: 'plataforma:meta' }));
    });

    it('recusa valor fora da faixa, unidade errada e formato inválido', () => {
      const ruins = {
        'acima do máximo': [limite('100000000001'), /fora da faixa/],
        'unidade errada': [limite('5000', 'razao'), /unidade do valor/],
        'centavos fracionados': [limite('10.5'), /malformado/],
        'negativo': [limite('-1'), /malformado/],
        'texto': [limite('muito'), /malformado/],
        'número em vez de texto': [JSON.stringify({ valor: 100, unidade: 'brl_centavos' }), /deve ser/],
        'campo extra': [JSON.stringify({ valor: '100', unidade: 'brl_centavos', moeda: 'USD' }), /deve ser/],
        'sem unidade': [JSON.stringify({ valor: '100' }), /deve ser/],
        'escalar': ['"100"', /deve ser/],
      };
      for (const [nome, [valor, padrao]] of Object.entries(ruins)) {
        assert.match(recusa(() => doApp(teto(valor))) ?? `aceitou: ${nome}`, padrao, nome);
      }
      assert.match(recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli: novoCliente(), categoria: 'eficiencia', natureza: 'limite', chave: 'eficiencia.roas_minimo', definicao: 'eficiencia.roas_minimo', valor: limite('1001', 'razao') }))) ?? '', /fora da faixa/);
    });

    it('recusa limite sem chave, valor ou definição, fora de investimento e eficiência, ou de chave incoerente', () => {
      const cli = novoCliente();
      const base = { org: ids.orgA, cli, natureza: 'limite' };
      const casos = {
        'sem valor': { ...base, categoria: 'investimento', chave: 'investimento.teto_mensal', definicao: 'investimento.teto_mensal' },
        'sem definição': { ...base, categoria: 'investimento', chave: 'investimento.teto_mensal', valor: limite('1') },
        'sem chave': { ...base, categoria: 'investimento', definicao: 'investimento.teto_mensal', valor: limite('1') },
        'categoria publico': { ...base, categoria: 'publico', chave: 'investimento.teto_mensal', definicao: 'investimento.teto_mensal', valor: limite('1') },
        'categoria diferente da definição': { ...base, categoria: 'eficiencia', chave: 'investimento.teto_mensal', definicao: 'investimento.teto_mensal', valor: limite('1') },
        'chave diferente da definição': { ...base, categoria: 'investimento', chave: 'investimento.teto_diario', definicao: 'investimento.teto_mensal', valor: limite('1') },
        'definição inexistente': { ...base, categoria: 'investimento', chave: 'investimento.nao_existe', definicao: 'investimento.nao_existe', valor: limite('1') },
      };
      for (const [nome, campos] of Object.entries(casos)) {
        assert.ok(recusa(() => doApp(sqlDecisao(campos))), `${nome}: devia recusar`);
      }
      assert.ok(recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, natureza: 'regra', chave: 'governanca.x', valor: limite('1') }))), 'regra com valor');
      assert.ok(recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, natureza: 'regra', texto: 'sem chave' }))), 'regra sem chave');
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}'`), '0');
    });

    it('definição desativada não aceita decisão nova, mas a antiga continua guardada', () => {
      const chave = `eficiencia.d${sufixo}`;
      dono(`INSERT INTO core.limit_definitions (key, name, category, measure, unit, period, direction, min_value, max_value)
            VALUES ('${chave}', 'Desativavel', 'eficiencia', 'custo_por_lead', 'brl_centavos', 'total', 'teto', '0', '1000')`);
      const campos = { org: ids.orgA, cli: novoCliente(), categoria: 'eficiencia', natureza: 'limite', chave, definicao: chave, valor: limite('10', 'brl_centavos') };
      const id = doApp(sqlDecisao(campos));
      dono(`UPDATE core.limit_definitions SET active = false WHERE key = '${chave}'`);
      assert.match(recusa(() => doApp(sqlDecisao({ ...campos, cli: novoCliente() }))) ?? '', /desativada/);
      assert.equal(dono(`SELECT definition_version FROM core.client_decisions WHERE id = '${id}'`), '1');
    });
  });

  describe('autoridade do agente', () => {
    const agente = { origem: 'agente', agente: 'agente-teste' };

    it('agente não registra limite nem regra como vigente; só proposta', () => {
      const cli = novoCliente();
      const limiteDoAgente = (status) =>
        sqlDecisao({ org: ids.orgA, cli, categoria: 'investimento', natureza: 'limite', chave: 'investimento.teto_mensal', definicao: 'investimento.teto_mensal', valor: limite('1000'), status, ...agente });
      assert.match(recusa(() => doWorker(limiteDoAgente('vigente'))) ?? '', /só registra limite ou regra como proposta/);
      assert.match(recusa(() => doApp(limiteDoAgente('vigente'))) ?? '', /só registra limite ou regra como proposta/);
      const proposta = doWorker(limiteDoAgente('proposta'));
      assert.equal(statusDe(proposta), 'proposta');

      assert.match(recusa(() => doWorker(sqlDecisao({ org: ids.orgA, cli, chave: 'etica_marca.x', categoria: 'etica_marca', ...agente }))) ?? '', /só registra limite ou regra como proposta/);
      const regra = doWorker(sqlDecisao({ org: ids.orgA, cli, chave: 'etica_marca.x', categoria: 'etica_marca', status: 'proposta', ...agente }));
      assert.equal(statusDe(regra), 'proposta');
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}' AND status = 'vigente'`), '0');
    });

    it('agente registra decisão de processo como vigente, e só essa', () => {
      const cli = novoCliente();
      const id = doWorker(sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', ...agente }));
      assert.equal(statusDe(id), 'vigente');
      assert.match(recusa(() => doWorker(sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', status: 'proposta', ...agente }))) ?? '', /só registra decisão de processo como vigente/);
      assert.ok(recusa(() => doWorker(sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'publico', ...agente }))));
    });

    it('origem agente exige agent_id; agent_id e idempotência só existem para o agente', () => {
      const cli = novoCliente();
      assert.ok(recusa(() => doWorker(sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', origem: 'agente' }))));
      assert.ok(recusa(() => doWorker(sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', origem: 'agencia', agente: 'x' }))));
      assert.ok(recusa(() => doWorker(sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', origem: 'agencia', idempotencia: 'k1' }))));
    });

    it('chave de idempotência repetida pelo mesmo agente é barrada; outro agente ou cliente não', () => {
      const cli = novoCliente();
      const campos = { org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', idempotencia: 'exec-1:0' };
      doWorker(sqlDecisao({ ...campos, ...agente }));
      assert.match(recusa(() => doWorker(sqlDecisao({ ...campos, ...agente }))) ?? '', /client_decisions_idempotencia|duplicate key/);
      doWorker(sqlDecisao({ ...campos, origem: 'agente', agente: 'outro-agente' }));
      doWorker(sqlDecisao({ ...campos, cli: ids.cliA2, ...agente }));
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}'`), '2');
    });

    it('a categoria exige coerência: agente com valor inválido não passa pela proposta', () => {
      assert.match(recusa(() => doWorker(sqlDecisao({ org: ids.orgA, cli: novoCliente(), categoria: 'investimento', natureza: 'limite', chave: 'investimento.teto_mensal', definicao: 'investimento.teto_mensal', valor: limite('100000000001'), status: 'proposta', ...agente }))) ?? '', /fora da faixa/);
    });
  });

  describe('ciclo de vida por evento', () => {
    it('proposta vira vigente ao ser efetivada; ao efetivar uma que supera, a anterior vira superada', () => {
      const cli = novoCliente();
      const atual = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.ciclo', titulo: 'atual' }));
      const proposta = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.ciclo', titulo: 'nova', status: 'proposta', supersede: atual }));
      assert.equal(statusDe(proposta), 'proposta');
      assert.equal(statusDe(atual), 'vigente');
      assert.equal(dono(`SELECT type FROM core.client_decision_events WHERE decision_id = '${proposta}'`), 'proposta');

      doApp(eventoApp(ids.orgA, cli, proposta, 'efetivada'));
      assert.equal(statusDe(proposta), 'vigente');
      assert.equal(statusDe(atual), 'superada');
      assert.equal(dono(`SELECT string_agg(type, ',' ORDER BY occurred_at, type) FROM core.client_decision_events WHERE decision_id = '${proposta}'`), 'proposta,efetivada');
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}' AND status = 'vigente'`), '1');
    });

    it('proposta sem anterior efetivada com outra vigente na mesma chave é barrada', () => {
      const cli = novoCliente();
      doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.dupla' }));
      const proposta = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.dupla', status: 'proposta', titulo: 'p' }));
      assert.match(recusa(() => doApp(eventoApp(ids.orgA, cli, proposta, 'efetivada'))) ?? '', /client_decisions_uma_vigente|duplicate key/);
      assert.equal(statusDe(proposta), 'proposta');
    });

    it('proposta obsoleta (a anterior já mudou) não se efetiva', () => {
      const cli = novoCliente();
      const atual = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.obsoleta' }));
      const proposta = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.obsoleta', status: 'proposta', titulo: 'p', supersede: atual }));
      doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.obsoleta', titulo: 'outra pessoa mudou', supersede: atual }));
      assert.match(recusa(() => doApp(eventoApp(ids.orgA, cli, proposta, 'efetivada'))) ?? '', /não está mais vigente/);
      assert.equal(statusDe(proposta), 'proposta');
    });

    it('rejeição só vale para proposta; revogação só para vigente e com motivo', () => {
      const cli = novoCliente();
      const proposta = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.rej', status: 'proposta' }));
      doApp(eventoApp(ids.orgA, cli, proposta, 'rejeitada', 'não procede'));
      assert.equal(statusDe(proposta), 'rejeitada');
      for (const tipo of ['efetivada', 'rejeitada']) {
        assert.match(recusa(() => doApp(eventoApp(ids.orgA, cli, proposta, tipo, 'x'))) ?? '', /transição inválida/, tipo);
      }
      assert.match(recusa(() => doApp(eventoApp(ids.orgA, cli, proposta, 'revogada', 'motivo valido'))) ?? '', /transição inválida/);

      const vigente = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.rev' }));
      assert.match(recusa(() => doApp(eventoApp(ids.orgA, cli, vigente, 'rejeitada', 'x'))) ?? '', /transição inválida/);
      assert.match(recusa(() => doApp(eventoApp(ids.orgA, cli, vigente, 'efetivada'))) ?? '', /transição inválida/);
      assert.match(recusa(() => doApp(eventoApp(ids.orgA, cli, vigente, 'revogada'))) ?? '', /client_decision_events_motivo/);
      assert.match(recusa(() => doApp(eventoApp(ids.orgA, cli, vigente, 'revogada', '  '))) ?? '', /client_decision_events_motivo/);
      assert.equal(statusDe(vigente), 'vigente');
      doApp(eventoApp(ids.orgA, cli, vigente, 'revogada', 'o cliente desistiu'));
      assert.equal(statusDe(vigente), 'revogada');
      assert.match(recusa(() => doApp(eventoApp(ids.orgA, cli, vigente, 'revogada', 'de novo'))) ?? '', /transição inválida/);

      const nova = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.rev', titulo: 'depois da revogação' }));
      assert.equal(statusDe(nova), 'vigente');
    });

    it('o app não grava evento superada, proposta nem redigida; nem para outro cliente', () => {
      const cli = novoCliente();
      const vigente = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.interno' }));
      for (const tipo of ['superada', 'proposta', 'redigida']) {
        assert.match(recusa(() => doApp(eventoApp(ids.orgA, cli, vigente, tipo, 'forjado pelo app'))) ?? '', /só nasce dos gatilhos/, tipo);
        assert.match(recusa(() => doWorker(eventoApp(ids.orgA, cli, vigente, tipo, 'forjado pelo worker'))) ?? '', /só nasce dos gatilhos/, tipo);
      }
      assert.match(recusa(() => doApp(eventoApp(ids.orgA, ids.cliA2, vigente, 'revogada', 'cliente trocado'))) ?? '', /client_decision_events_decisao_fk|violates foreign key/);
      assert.equal(statusDe(vigente), 'vigente');
    });

    it('decisão nasce só proposta ou vigente', () => {
      const cli = novoCliente();
      for (const status of ['superada', 'revogada', 'rejeitada']) {
        assert.match(recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.nasce', status }))) ?? '', /nasce proposta ou vigente/, status);
      }
    });
  });

  describe('redação LGPD', () => {
    it('só o worker redige; a linha, o valor e o histórico ficam', () => {
      const cli = novoCliente();
      const id = doApp(
        sqlDecisao({ org: ids.orgA, cli, categoria: 'investimento', natureza: 'limite', chave: 'investimento.teto_mensal', definicao: 'investimento.teto_mensal', valor: limite('777'), titulo: 'João Silva autorizou', contextoTexto: 'CPF 000.000.000-00', texto: 'texto pessoal', evidencia: 'zap do João' }),
      );
      assert.match(recusa(() => doApp(`SELECT core.redigir_decisao('${id}', 'pedido do titular')`)) ?? '', /permission denied/);
      assert.equal(dono(`SELECT has_function_privilege('orla_app', 'core.redigir_decisao(uuid, text)', 'EXECUTE')`), 'f');
      assert.equal(dono(`SELECT has_function_privilege('orla_worker', 'core.redigir_decisao(uuid, text)', 'EXECUTE')`), 't');
      assert.equal(dono(`SELECT has_function_privilege('public', 'core.redigir_decisao(uuid, text)', 'EXECUTE')`), 'f');
      assert.equal(dono(`SELECT title FROM core.client_decisions WHERE id = '${id}'`), 'João Silva autorizou');

      assert.match(recusa(() => doWorker(`SELECT core.redigir_decisao('${id}', 'x')`)) ?? '', /motivo da redação obrigatório/);
      doWorker(`SELECT core.redigir_decisao('${id}', 'pedido do titular')`);

      assert.equal(
        dono(`SELECT title||'|'||context||'|'||body||'|'||evidence||'|'||(value->>'valor')||'|'||status||'|'||(redacted_at IS NOT NULL) FROM core.client_decisions WHERE id = '${id}'`),
        '[redigido]|[redigido]|[redigido]|[redigido]|777|vigente|true',
      );
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE id = '${id}'`), '1');
      assert.equal(dono(`SELECT string_agg(type, ',' ORDER BY occurred_at, type) FROM core.client_decision_events WHERE decision_id = '${id}'`), 'efetivada,redigida');
      assert.equal(dono(`SELECT reason FROM core.client_decision_events WHERE decision_id = '${id}' AND type = 'redigida'`), 'pedido do titular');

      doWorker(`SELECT core.redigir_decisao('${id}', 'segunda vez')`);
      assert.equal(dono(`SELECT count(*) FROM core.client_decision_events WHERE decision_id = '${id}' AND type = 'redigida'`), '1');
      assert.match(recusa(() => doWorker(`SELECT core.redigir_decisao(gen_random_uuid(), 'inexistente')`)) ?? '', /decisão inexistente/);
    });

    it('redige também "em nome de" e o motivo livre dos eventos, mantendo o motivo da própria redação', () => {
      const cli = novoCliente();
      const id = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.lgpd', titulo: 'Pedido da Ana', emNomeDe: 'Ana Souza, CPF 000', evidencia: 'zap da Ana' }));
      doApp(eventoApp(ids.orgA, cli, id, 'revogada', 'Ana pediu por WhatsApp 11 99999-0000'));
      const proposta = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.lgpd2', status: 'proposta' }));
      doApp(eventoApp(ids.orgA, cli, proposta, 'rejeitada', 'João não quer'));
      doWorker(`SELECT core.redigir_decisao('${id}', 'pedido do titular')`);
      doWorker(`SELECT core.redigir_decisao('${proposta}', 'pedido do titular 2')`);
      assert.equal(dono(`SELECT on_behalf_of||'|'||evidence||'|'||status FROM core.client_decisions WHERE id = '${id}'`), '[redigido]|[redigido]|revogada');
      assert.equal(dono(`SELECT reason FROM core.client_decision_events WHERE decision_id = '${id}' AND type = 'revogada'`), '[redigido]');
      assert.equal(dono(`SELECT reason FROM core.client_decision_events WHERE decision_id = '${proposta}' AND type = 'rejeitada'`), '[redigido]');
      assert.equal(dono(`SELECT reason FROM core.client_decision_events WHERE decision_id = '${id}' AND type = 'redigida'`), 'pedido do titular');
      assert.equal(dono(`SELECT count(*) FROM core.client_decision_events WHERE client_id = '${cli}' AND (reason LIKE '%Ana%' OR reason LIKE '%João%')`), '0');
    });

    it('redige a cadeia inteira de supersessão nos dois sentidos, com um evento redigida por decisão', () => {
      const cli = novoCliente();
      const v1 = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.cadeia', titulo: 'Maria aprova', texto: 'Maria 11 99999-0000' }));
      const v2 = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.cadeia', titulo: 'Maria aprova', texto: 'Maria 11 99999-0000', supersede: v1 }));
      const v3 = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.cadeia', titulo: 'Maria aprova', texto: 'Maria e João', supersede: v2 }));
      doApp(eventoApp(ids.orgA, cli, v3, 'revogada', 'Maria saiu'));
      const fora = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.outra_cadeia', titulo: 'Maria também aqui' }));
      doWorker(`SELECT core.redigir_decisao('${v2}', 'pedido da titular')`);
      for (const id of [v1, v2, v3]) {
        assert.equal(dono(`SELECT title||'|'||body||'|'||(redacted_at IS NOT NULL) FROM core.client_decisions WHERE id = '${id}'`), '[redigido]|[redigido]|true', id);
        assert.equal(dono(`SELECT count(*) FROM core.client_decision_events WHERE decision_id = '${id}' AND type = 'redigida'`), '1', id);
      }
      assert.equal(dono(`SELECT reason FROM core.client_decision_events WHERE decision_id = '${v3}' AND type = 'revogada'`), '[redigido]');
      assert.equal(dono(`SELECT title FROM core.client_decisions WHERE id = '${fora}'`), 'Maria também aqui', 'outra chave fica intacta');
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}' AND (title LIKE '%Maria%' OR body LIKE '%Maria%') AND key = 'governanca.cadeia'`), '0');
      doWorker(`SELECT core.redigir_decisao('${v1}', 'de novo')`);
      assert.equal(dono(`SELECT count(*) FROM core.client_decision_events WHERE client_id = '${cli}' AND type = 'redigida'`), '3', 'reexecutar não duplica');
    });

    it('a exceção do motivo é estreita: fora de redigir_decisao, nem o dono troca o motivo, nem com a marca de outra decisão', () => {
      const cli = novoCliente();
      const id = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.lgpd3' }));
      doApp(eventoApp(ids.orgA, cli, id, 'revogada', 'motivo original'));
      const evento = dono(`SELECT id FROM core.client_decision_events WHERE decision_id = '${id}' AND type = 'revogada'`);
      assert.match(recusa(() => dono(`UPDATE core.client_decision_events SET reason = '[redigido]' WHERE id = '${evento}'`)) ?? '', /só de acréscimo/);
      assert.match(
        recusa(() => dono(`SELECT set_config('orla.redigindo_decisao', gen_random_uuid()::text, false); UPDATE core.client_decision_events SET reason = '[redigido]' WHERE id = '${evento}'`)) ?? '',
        /só de acréscimo/,
      );
      assert.match(
        recusa(() => doWorker(`SELECT set_config('orla.redigindo_decisao', '${id}', false); UPDATE core.client_decision_events SET reason = '[redigido]' WHERE id = '${evento}'`)) ?? '',
        /permission denied/,
      );
      assert.equal(dono(`SELECT reason FROM core.client_decision_events WHERE id = '${evento}'`), 'motivo original');
    });

    it('a redação não abre brecha de edição: só o app ou o dono por UPDATE direto continuam negados', () => {
      const cli = novoCliente();
      const id = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.redacao', titulo: 'ainda original' }));
      assert.match(recusa(() => dono(`UPDATE core.client_decisions SET title = '[redigido]', redacted_at = now() WHERE id = '${id}'`)) ?? '', /imutável/);
      assert.match(recusa(() => doWorker(`UPDATE core.client_decisions SET title = '[redigido]', redacted_at = now() WHERE id = '${id}'`)) ?? '', /permission denied/);
      assert.equal(dono(`SELECT title FROM core.client_decisions WHERE id = '${id}'`), 'ainda original');
    });
  });

  describe('brain e expurgo', () => {
    it('cada decisão e cada evento sobe requested_at do brain do cliente', () => {
      const cli = novoCliente();
      const id = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.brain' }));
      const primeiro = dono(`SELECT requested_at FROM core.client_context_brain WHERE client_id = '${cli}'`);
      assert.ok(primeiro, 'o brain do cliente deve existir depois da decisão');
      dono('SELECT pg_sleep(0.05)');
      doApp(eventoApp(ids.orgA, cli, id, 'revogada', 'mudança de rota'));
      const segundo = dono(`SELECT requested_at FROM core.client_context_brain WHERE client_id = '${cli}'`);
      assert.ok(new Date(segundo) > new Date(primeiro), `${segundo} deveria ser depois de ${primeiro}`);
    });

    it('o expurgo do cliente leva decisões, eventos e cadeias de supersessão', () => {
      const cli = cliente(ids.orgA, 'expurgo');
      const a = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.expurgo', titulo: 'v1' }));
      doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.expurgo', titulo: 'v2', supersede: a }));
      doApp(sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo' }));
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}'`), '3');
      assert.ok(Number(dono(`SELECT count(*) FROM core.client_decision_events WHERE client_id = '${cli}'`)) >= 4);

      assert.match(recusa(() => dono(`DELETE FROM core.client_decisions WHERE client_id = '${cli}'`)) ?? '', /não se apagam/);
      dono(`DELETE FROM core.clients WHERE id = '${cli}'`);
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}'`), '0');
      assert.equal(dono(`SELECT count(*) FROM core.client_decision_events WHERE client_id = '${cli}'`), '0');
    });
  });

  describe('alteração com vigência futura (achado 1)', () => {
    it('supersessão vigente com início futuro é recusada; hoje e passado passam; registro novo futuro passa', () => {
      const cli = novoCliente();
      const a = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.futuro', titulo: 'v1' }));
      assert.match(
        recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.futuro', titulo: 'v2', supersede: a, inicio: '2999-01-01' }))) ?? '',
        /não pode começar no futuro/,
      );
      assert.equal(statusDe(a), 'vigente');
      const b = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.futuro', titulo: 'v2', supersede: a, inicio: '2026-01-01' }));
      assert.equal(statusDe(a), 'superada');
      assert.equal(statusDe(b), 'vigente');
      assert.match(doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.futuro_novo', inicio: '2999-01-01' })), /^[0-9a-f-]{36}$/);
    });

    it('proposta que supera com início futuro não é efetivada; proposta vencida também não', () => {
      const cli = novoCliente();
      const atual = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.pfut' }));
      const futura = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.pfut', status: 'proposta', supersede: atual, inicio: '2999-01-01' }));
      assert.match(recusa(() => doApp(eventoApp(ids.orgA, cli, futura, 'efetivada'))) ?? '', /não pode começar no futuro/);
      assert.equal(statusDe(atual), 'vigente');
      const vencida = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.pvenc', status: 'proposta', inicio: '2020-01-01', fim: '2020-02-01' }));
      assert.match(recusa(() => doApp(eventoApp(ids.orgA, cli, vencida, 'efetivada'))) ?? '', /já terminou/);
      assert.equal(statusDe(vencida), 'proposta');
    });

    it('proposta de limite cuja definição foi desativada não é efetivada', () => {
      const chave = `investimento.pd${sufixo}`;
      dono(`INSERT INTO core.limit_definitions (key, name, category, measure, unit, period, direction, min_value, max_value)
            VALUES ('${chave}', 'Desativavel', 'investimento', 'gasto', 'brl_centavos', 'mes', 'teto', '0', '1000')`);
      const cli = novoCliente();
      const proposta = doApp(sqlDecisao({ org: ids.orgA, cli, categoria: 'investimento', natureza: 'limite', chave, definicao: chave, valor: limite('10'), status: 'proposta' }));
      dono(`UPDATE core.limit_definitions SET active = false WHERE key = '${chave}'`);
      assert.match(recusa(() => doApp(eventoApp(ids.orgA, cli, proposta, 'efetivada'))) ?? '', /desativada/);
      assert.equal(statusDe(proposta), 'proposta');
    });
  });

  describe('autoridade no banco não depende só de origin (achado 4)', () => {
    it('limite ou regra vigente sem pessoa é recusado ao app e ao worker; no app a pessoa é a da sessão', () => {
      const cli = novoCliente();
      const semPessoa = sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.sem_pessoa', decididoPor: null });
      assert.match(recusa(() => doApp(semPessoa)) ?? '', /exige a pessoa que decidiu/);
      assert.match(recusa(() => doWorker(semPessoa)) ?? '', /exige a pessoa que decidiu/);
      assert.match(
        recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.outra_pessoa', decididoPor: ids.outroUsuario }))) ?? '',
        /usuário da sessão/,
      );
      assert.match(recusa(() => comoApp(ids.orgA, '*', sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.sem_sessao' }), '')) ?? '', /usuário da sessão/);
      assert.match(
        recusa(() => doWorker(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.worker_outra', decididoPor: ids.outroUsuario }))) ?? '',
        /usuário da sessão/,
        'o worker também não grava em nome de outra pessoa',
      );
      assert.match(comoWorker(ids.orgA, '*', sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.worker_pessoa', decididoPor: ids.outroUsuario }), ids.outroUsuario), /^[0-9a-f-]{36}$/);
      assert.match(
        recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.proposta_outra', status: 'proposta', decididoPor: ids.outroUsuario }))) ?? '',
        /usuário da sessão/,
        'decided_by vale para qualquer natureza e status',
      );
      assert.match(
        recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', decididoPor: ids.outroUsuario }))) ?? '',
        /usuário da sessão/,
      );
      for (const chamar of [comoApp, comoWorker]) {
        assert.match(
          recusa(() => chamar(ids.orgA, '*', sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.fora', decididoPor: ids.naoMembro }), ids.naoMembro)) ?? '',
          /membro vivo/,
        );
      }
      assert.match(
        recusa(() => comoApp(ids.orgB, '*', sqlDecisao({ org: ids.orgB, cli: ids.cliB, chave: 'governanca.outra_org', decididoPor: ids.outroUsuario }), ids.outroUsuario)) ?? '',
        /membro vivo/,
        'membro da A não decide na B',
      );
      assert.match(doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.proposta_sem_pessoa', status: 'proposta', decididoPor: null })), /^[0-9a-f-]{36}$/);
      assert.match(doApp(sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', decididoPor: null })), /^[0-9a-f-]{36}$/);
      assert.match(
        recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.do_cliente', origem: 'cliente' }))) ?? '',
        /cliente só propõe/,
      );
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}' AND status = 'vigente' AND decided_by IS NULL AND nature <> 'decisao'`), '0');
    });

    it('efetivada, revogada e rejeitada exigem uma pessoa; agente nunca as grava em limite ou regra', () => {
      const cli = novoCliente();
      const proposta = doWorker(sqlDecisao({ org: ids.orgA, cli, chave: 'etica_marca.ag', categoria: 'etica_marca', status: 'proposta', origem: 'agente', agente: 'agente-teste' }));
      for (const [nome, executar, padrao] of [
        ['app sem ator', () => doApp(eventoApp(ids.orgA, cli, proposta, 'efetivada', null, { ator: null })), /exige uma pessoa/],
        ['app com outra pessoa', () => doApp(eventoApp(ids.orgA, cli, proposta, 'efetivada', null, { ator: ids.outroUsuario })), /usuário da sessão/],
        ['worker sem ator', () => doWorker(eventoApp(ids.orgA, cli, proposta, 'efetivada', null, { ator: null })), /exige uma pessoa/],
        ['worker com outra pessoa', () => doWorker(eventoApp(ids.orgA, cli, proposta, 'efetivada', null, { ator: ids.outroUsuario })), /usuário da sessão/],
        ['não membro', () => comoApp(ids.orgA, '*', eventoApp(ids.orgA, cli, proposta, 'efetivada', null, { ator: ids.naoMembro }), ids.naoMembro), /membro vivo/],
        ['worker como agente', () => doWorker(eventoApp(ids.orgA, cli, proposta, 'efetivada', null, { tipoDeAtor: 'agente' })), /exige uma pessoa/],
        ['dono como agente', () => dono(eventoApp(ids.orgA, cli, proposta, 'efetivada', null, { tipoDeAtor: 'agente', ator: null })), /agente nunca efetiva/],
        ['worker rejeita como sistema', () => doWorker(eventoApp(ids.orgA, cli, proposta, 'rejeitada', 'x', { tipoDeAtor: 'sistema' })), /exige uma pessoa/],
      ]) {
        assert.match(recusa(executar) ?? `aceitou: ${nome}`, padrao, nome);
      }
      assert.equal(statusDe(proposta), 'proposta');
      comoWorker(ids.orgA, '*', eventoApp(ids.orgA, cli, proposta, 'efetivada', null, { ator: ids.outroUsuario }), ids.outroUsuario);
      assert.equal(statusDe(proposta), 'vigente');
      assert.equal(dono(`SELECT actor_kind||'/'||actor_user_id FROM core.client_decision_events WHERE decision_id = '${proposta}' AND type = 'efetivada'`), `usuario/${ids.outroUsuario}`);
    });
  });

  describe('teto do agente atômico (achado 5)', () => {
    const doAgente = (cli, execucao, i) =>
      sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', origem: 'agente', agente: 'agente-teto', execucao, idempotencia: `${execucao}:${i}` });
    const emParalelo = (cli, quantos, guc, execucao = () => 'exec-teto') =>
      Promise.all(
        Array.from({ length: quantos }, (_, i) =>
          executar('docker', argumentos('orla_worker', variavel('WORKER_DB_PASSWORD'), `${contexto(ids.orgA, '*')} BEGIN; ${guc} ${doAgente(cli, execucao(i), i)}; SELECT pg_sleep(0.2); COMMIT;`)).then(
            () => 'ok',
            (falha) => String(falha.stderr),
          ),
        ),
      );

    it('N inserções paralelas na mesma execução não passam do teto por execução', async () => {
      const cli = novoCliente();
      const resultados = await emParalelo(cli, 8, "SET LOCAL orla.teto_agente_por_execucao = '3';");
      assert.equal(resultados.filter((r) => r === 'ok').length, 3, JSON.stringify(resultados));
      assert.ok(resultados.filter((r) => r !== 'ok').every((r) => /teto de decisões do agente por execução/.test(r)), JSON.stringify(resultados));
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}'`), '3');
    });

    it('o teto diário por cliente vale entre execuções diferentes, também em paralelo', async () => {
      const cli = novoCliente();
      const resultados = await emParalelo(cli, 6, "SET LOCAL orla.teto_agente_por_dia = '2';", (i) => `exec-dia-${i}`);
      assert.equal(resultados.filter((r) => r === 'ok').length, 2, JSON.stringify(resultados));
      assert.ok(resultados.filter((r) => r !== 'ok').every((r) => /teto diário/.test(r)));
    });

    it('created_at é sempre now() para app e worker; só o script de migração (worker, GUC, origem não agente) preserva a data', () => {
      const cli = novoCliente();
      const antiga = '2020-01-01T00:00:00Z';
      const ano = (id) => dono(`SELECT extract(year FROM created_at)::int FROM core.client_decisions WHERE id = '${id}'`);
      const hoje = String(new Date().getUTCFullYear());
      const doAgenteAntigo = (i, extra = {}) => ({ ...{ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', origem: 'agente', agente: 'agente-data', execucao: 'exec-data', idempotencia: `data:${i}` }, criadoEm: antiga, ...extra });
      assert.equal(ano(doWorker(sqlDecisao(doAgenteAntigo(1)))), hoje);
      assert.equal(ano(doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.data_app', criadoEm: antiga }))), hoje);
      assert.equal(ano(doWorker(`SET orla.migracao_contexto = 'sim'; ${sqlDecisao(doAgenteAntigo(2))}`)), hoje, 'agente nunca preserva a data');
      assert.equal(ano(doApp(`SET orla.migracao_contexto = 'sim'; ${sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.data_app2', criadoEm: antiga })}`)), hoje, 'o app nunca preserva a data');
      assert.equal(ano(doWorker(`SET orla.migracao_contexto = 'sim'; ${sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.data_migrada', criadoEm: antiga })}`)), '2020');
      assert.equal(ano(doWorker(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.data_worker_sem_guc', criadoEm: antiga }))), hoje, 'worker sem a GUC nunca preserva a data');
    });

    it('o teto diário não se burla por created_at retroativo', () => {
      const cli = novoCliente();
      const linha = (i) =>
        sqlDecisao({ org: ids.orgA, cli, natureza: 'decisao', categoria: 'processo', origem: 'agente', agente: 'agente-retro', execucao: `exec-retro-${i}`, idempotencia: `retro:${i}`, criadoEm: '2020-01-01T00:00:00Z' });
      const comTeto = (sql) => doWorker(`SET orla.teto_agente_por_dia = '2'; SET orla.migracao_contexto = 'sim'; ${sql}`);
      comTeto(linha(1));
      comTeto(linha(2));
      assert.match(recusa(() => comTeto(linha(3))) ?? '', /teto diário/);
      assert.equal(dono(`SELECT count(*) FROM core.client_decisions WHERE client_id = '${cli}' AND created_at < now() - interval '1 day'`), '0');
    });

    it('o GUC só reduz: valor acima do padrão não amplia o teto', () => {
      const cli = novoCliente();
      dono(Array.from({ length: 50 }, (_, i) => doAgente(cli, 'exec-padrao', i)).join('; '));
      assert.match(recusa(() => doWorker(`SET orla.teto_agente_por_execucao = '100000'; ${doAgente(cli, 'exec-padrao', 99)}`)) ?? '', /por execução atingido \(50\)/);
    });
  });

  describe('prova de inquilino nas referências (achado 8)', () => {
    it('via_link_id de outro cliente é recusado pela FK composta; o do próprio cliente passa', () => {
      const cli = novoCliente();
      const outro = novoCliente();
      const link = (cliente) =>
        dono(`INSERT INTO core.client_context_links (organization_id, client_id, token_hash, sections, expires_at)
              VALUES ('${ids.orgA}', '${cliente}', '${randomBytes(32).toString('hex')}', ARRAY['restricoes'], now() + interval '1 day') RETURNING id`);
      const doOutro = link(outro);
      assert.match(
        recusa(() => doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.link', status: 'proposta', origem: 'cliente', link: doOutro, decididoPor: null }))) ?? '',
        /client_decisions_link_fk|violates foreign key/,
      );
      const proprio = link(cli);
      assert.match(doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.link', status: 'proposta', origem: 'cliente', link: proprio, decididoPor: null })), /^[0-9a-f-]{36}$/);
    });

    it('definição de limite de outra organização não serve à decisão', () => {
      const chave = `eficiencia.org${sufixo}`;
      dono(`INSERT INTO core.limit_definitions (key, organization_id, name, category, measure, unit, period, direction, min_value, max_value)
            VALUES ('${chave}', '${ids.orgB}', 'Da B', 'eficiencia', 'custo_por_lead', 'brl_centavos', 'total', 'teto', '0', '1000')`);
      const campos = { org: ids.orgA, cli: novoCliente(), categoria: 'eficiencia', natureza: 'limite', chave, definicao: chave, valor: limite('10') };
      assert.match(recusa(() => doApp(sqlDecisao(campos))) ?? '', /outra organização/);
      assert.match(comoApp(ids.orgB, '*', sqlDecisao({ ...campos, org: ids.orgB, cli: ids.cliB })), /^[0-9a-f-]{36}$/);
    });
  });

  describe('livro da migração do contexto (achado B3)', () => {
    it('só o worker insere; o app só lê; ninguém edita nem apaga; isolado por organização', () => {
      const cli = novoCliente();
      const decisao = doApp(sqlDecisao({ org: ids.orgA, cli, chave: 'governanca.livro' }));
      const inserir = (campo) => `INSERT INTO core.regras_migracao_contexto (organization_id, client_id, field_key, decision_id) VALUES ('${ids.orgA}', '${cli}', '${campo}', '${decisao}')`;
      assert.match(recusa(() => doApp(inserir('quem_aprova'))) ?? '', /row-level security/);
      assert.equal(
        dono(`SELECT string_agg(polname || ':' || polcmd::text || ':' || array_to_string(ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(polroles) ORDER BY 1), '+'), ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'core.regras_migracao_contexto'::regclass`),
        'regras_migracao_contexto_insercao:a:orla_worker,regras_migracao_contexto_leitura:r:orla_app',
      );
      doWorker(inserir('quem_aprova'));
      assert.equal(doApp(`SELECT count(*) FROM core.regras_migracao_contexto WHERE client_id = '${cli}'`), '1');
      assert.equal(comoApp(ids.orgB, '*', `SELECT count(*) FROM core.regras_migracao_contexto WHERE client_id = '${cli}'`), '0');
      assert.match(recusa(() => comoWorker(ids.orgB, '*', inserir('prazo_de_aprovacao'))) ?? '', /row-level security/);
      for (const sql of [`UPDATE core.regras_migracao_contexto SET field_key = 'x' WHERE client_id = '${cli}'`, `DELETE FROM core.regras_migracao_contexto WHERE client_id = '${cli}'`]) {
        assert.match(recusa(() => doWorker(sql)) ?? '', /permission denied/, sql);
        assert.match(recusa(() => dono(sql)) ?? '', /só de acréscimo|não se apagam/, sql);
      }
    });
  });

  describe('privilégios', () => {
    it('o app e o worker têm só SELECT e INSERT; nenhuma função nova do app é SECURITY DEFINER executável', () => {
      for (const papel of ['orla_app', 'orla_worker']) {
        for (const tabela of ['core.client_decisions', 'core.client_decision_events']) {
          const privilegios = dono(
            `SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege('${papel}', '${tabela}', p)`,
          );
          assert.equal(privilegios, 'INSERT,SELECT', `${papel} em ${tabela}`);
        }
        assert.equal(dono(`SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p WHERE has_table_privilege('${papel}', 'core.limit_definitions', p)`), 'SELECT');
        assert.equal(
          dono(`SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege('${papel}', 'core.regras_migracao_contexto', p)`),
          'INSERT,SELECT',
          `${papel} no livro da migração (o INSERT do app é barrado pela RLS: só há política de INSERT para o worker)`,
        );
      }
      const executaveis = dono(
        `SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'core' AND p.prosecdef AND (p.proname LIKE 'decisao\\_%' OR p.proname = 'redigir_decisao') AND has_function_privilege('orla_app', p.oid, 'EXECUTE')`,
      );
      assert.equal(executaveis, '');
      assert.equal(
        dono(`SELECT bool_and(relrowsecurity AND relforcerowsecurity)::text FROM pg_class WHERE oid IN ('core.client_decisions'::regclass, 'core.client_decision_events'::regclass, 'core.limit_definitions'::regclass, 'core.regras_migracao_contexto'::regclass)`),
        'true',
      );
    });
  });
});
