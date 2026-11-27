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

const argumentos = (usuario, senha, sqlBruto) => [
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
  prepararSql(sqlBruto),
];

const psql = (usuario, senha, sql) => execFileSync('docker', argumentos(usuario, senha, sql), { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

const RUN_PADRAO = 'run-padrao';
const MARCA_DE_EXECUCAO = /@@RUN\|([^|@]+)\|([^|@]+)@@/g;
const MARCA_DE_FICHA = /@@FICHA\|([^|@]+)\|([^|@]+)@@/g;
const MARCA_DE_FICHA_EXATA = /@@FICHAX\|([^|@]+)@@/g;
const execucoesFisicas = new Map();
let sequenciaDeExecucao = 0;

const tokenDeExecucao = (logico, plano) => `@@RUN|${logico}|${plano}@@`;

const preludioDaFicha = (execucaoExata, logico, plano, ficha) =>
  `DO $$ BEGIN PERFORM set_config('orla.ficha_execucao', '${ficha ?? (execucaoExata ? `@@FICHAX|${execucaoExata}@@` : `@@FICHA|${logico}|${plano}@@`)}', true); END $$; `;

const fichaDaExecucao = (id) => {
  const lida = psql('postgres', null, `SELECT coalesce((SELECT tentativas::text FROM core.strategy_plan_runs WHERE agent_run_id = '${id}'), '1')`).split('\n').at(-1).trim();
  return lida;
};

const execucaoViva = (id) =>
  psql('postgres', null, `SELECT count(*) FROM core.strategy_plan_runs WHERE agent_run_id = '${id}' AND status = 'rodando' AND lease_until > now()`).split('\n').at(-1).trim() === '1';

function garantirExecucao(logico, plano) {
  if (!/^[0-9a-f-]{36}$/.test(plano)) return logico;
  const chave = `${logico}|${plano}`;
  const atual = execucoesFisicas.get(chave);
  if (atual && execucaoViva(atual)) return atual;
  const dadosDoPlano = psql('postgres', null, `SELECT organization_id || ',' || client_id FROM core.strategy_plans WHERE id = '${plano}'`).split('\n').at(-1).trim();
  const [org, cli] = dadosDoPlano.split(',');
  if (!org || !cli) return logico;
  const jaUsado = psql('postgres', null, `SELECT count(*) FROM core.strategy_plan_runs WHERE agent_run_id = '${logico}'`).split('\n').at(-1).trim() !== '0';
  const fisico = !atual && !jaUsado ? logico : `${logico}.${++sequenciaDeExecucao}`.slice(0, 120);
  psql(
    'orla_worker',
    variavel('WORKER_DB_PASSWORD'),
    `SET app.organization_id = '${org}'; SET app.client_ids = '*'; SET app.user_id = ''; UPDATE core.strategy_plan_runs SET status = 'concluida', etapa = 'fim' WHERE plan_id = '${plano}' AND status IN ('pendente', 'rodando')`,
  );
  psql(
    'postgres',
    null,
    `INSERT INTO core.strategy_plan_runs (organization_id, client_id, plan_id, kind, pedido, agent_run_id, requested_kind, status, etapa, tentativas, lease_until)
     VALUES ('${org}', '${cli}', '${plano}', 'revisar', '{"motivo":"brain_mudou"}'::jsonb, '${fisico}', 'sistema', 'rodando', 'redigir', 1, now() + interval '1 hour')`,
  );
  execucoesFisicas.set(chave, fisico);
  return fisico;
}

const prepararSql = (sql) =>
  sql
    .replace(MARCA_DE_EXECUCAO, (_marca, logico, plano) => garantirExecucao(logico, plano))
    .replace(MARCA_DE_FICHA, (_marca, logico, plano) => fichaDaExecucao(execucoesFisicas.get(`${logico}|${plano}`) ?? logico))
    .replace(MARCA_DE_FICHA_EXATA, (_marca, run) => fichaDaExecucao(run));
const ultimaLinha = (texto) => texto.split('\n').at(-1).trim();
const dono = (sql) => ultimaLinha(psql('postgres', null, sql));

const contexto = (organizacao, clientes, usuario) =>
  `SET app.organization_id = '${organizacao}'; SET app.client_ids = '${clientes}'; SET app.user_id = '${usuario ?? ''}'; `;
const comoApp = (organizacao, clientes, usuario, sql) => ultimaLinha(psql('orla_app', variavel('APP_DB_PASSWORD'), contexto(organizacao, clientes, usuario) + sql));
const comoWorker = (organizacao, clientes, usuario, sql) => ultimaLinha(psql('orla_worker', variavel('WORKER_DB_PASSWORD'), contexto(organizacao, clientes, usuario) + sql));

const esperarSessaoDormindo = async (marca) => {
  const limite = Date.now() + 20_000;
  while (Date.now() < limite) {
    const achou = dono(`SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid() AND query LIKE '%${marca}%'`);
    if (achou !== '0') return;
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
  throw new Error(`nenhuma sessão ativa com ${marca}`);
};

const recusa = (fn) => {
  try {
    fn();
    return null;
  } catch (falha) {
    return String(falha.stderr ?? falha.message);
  }
};

const aspas = (valor) => (valor === null || valor === undefined ? 'NULL' : `'${String(valor).replaceAll("'", "''")}'`);
const HASH = 'a'.repeat(64);

const disponibilidade = (() => {
  try {
    const existe = ultimaLinha(psql('postgres', null, "SELECT to_regclass('core.strategy_plan_events') IS NOT NULL AND to_regprocedure('core.redigir_plano(uuid,text)') IS NOT NULL"));
    return existe === 't' ? null : `container ${CONTAINER} sem a migração 0143 aplicada`;
  } catch (falha) {
    return `Postgres do container ${CONTAINER} indisponível (${String(falha.message).split('\n')[0]})`;
  }
})();

if (disponibilidade && process.env.CI) {
  describe('Strategy Plan, tabelas núcleo (migração 0143, ADR 0056)', () => {
    it('o Postgres do harness precisa estar disponível e migrado no CI', () => {
      assert.fail(disponibilidade);
    });
  });
}

const sqlVersao = ({ id = randomUUID(), org, cli, plano, status, autor = 'usuario', usuario, agente = 'comite', execucao = RUN_PADRAO, execucaoExata, ficha, chave, supersede, conteudo = '{"intencao":{"horizonte":"12m"}}' }) => {
  const agentico = autor === 'agente';
  const colunas = {
    id,
    organization_id: org,
    client_id: cli,
    plan_id: plano,
    content: conteudo,
    schema_version: 1,
    status,
    supersedes_id: supersede,
    author_kind: autor,
    author_user_id: agentico ? undefined : usuario,
    agent_id: agentico ? agente : undefined,
    agent_run_id: agentico ? (execucaoExata ?? tokenDeExecucao(execucao, plano)) : undefined,
    idempotency_key: agentico ? (chave ?? randomBytes(6).toString('hex')) : undefined,
  };
  const presentes = Object.entries(colunas).filter(([, valor]) => valor !== undefined);
  const nomes = presentes.map(([nome]) => nome).join(', ');
  const valores = presentes.map(([nome, valor]) => (nome === 'content' ? `${aspas(valor)}::jsonb` : nome === 'schema_version' ? valor : aspas(valor))).join(', ');
  const preludio = agentico ? preludioDaFicha(execucaoExata, execucao, plano, ficha) : '';
  return `${preludio}INSERT INTO core.strategy_plan_versions (${nomes}) VALUES (${valores}) RETURNING id;`;
};

const payloadPadrao = (tipo) => {
  if (tipo === 'parecer') return JSON.stringify({ persona: `p${randomBytes(5).toString('hex')}`, veredito: 'aprova' });
  if (tipo === 'gate') return JSON.stringify({ resultado: 'aprovado' });
  return '{}';
};

const planoDaVersao = (versao) => ultimaLinha(psql('postgres', null, `SELECT coalesce((SELECT plan_id::text FROM core.strategy_plan_versions WHERE id = '${versao}'), 'ausente')`));

const sqlEvento = ({ org, cli, versao, tipo, ator = 'usuario', usuario, agente = 'comite', execucao = RUN_PADRAO, execucaoExata, ficha, chave, payload = payloadPadrao(tipo) }) => {
  const agentico = ator === 'agente';
  const planoDoEvento = agentico ? planoDaVersao(versao) : null;
  const execucaoDoEvento = agentico ? (execucaoExata ?? tokenDeExecucao(execucao, planoDoEvento)) : null;
  const preludio = agentico ? preludioDaFicha(execucaoExata, execucao, planoDoEvento, ficha) : '';
  return `${preludio}INSERT INTO core.strategy_plan_events (organization_id, client_id, version_id, kind, actor_kind, actor_user_id, agent_id, agent_run_id, idempotency_key, payload)
    VALUES (${aspas(org)}, ${aspas(cli)}, ${aspas(versao)}, ${aspas(tipo)}, ${aspas(ator)}, ${aspas(ator === 'usuario' ? usuario : null)}, ${aspas(agentico ? agente : null)},
            ${aspas(execucaoDoEvento)}, ${aspas(agentico ? chave : null)}, ${aspas(payload)}::jsonb);`;
};

const sqlRef = ({ org, cli, versao, urn, hash = HASH, papel = 'premissa' }) =>
  `INSERT INTO core.strategy_plan_refs (organization_id, client_id, version_id, urn, content_hash, role)
   VALUES (${aspas(org)}, ${aspas(cli)}, ${aspas(versao)}, ${aspas(urn)}, ${aspas(hash)}, ${aspas(papel)});`;

describe('Strategy Plan, tabelas núcleo (migração 0143, ADR 0056)', { concurrency: false, skip: disponibilidade && !process.env.CI ? disponibilidade : disponibilidade ? true : false }, () => {
  const ids = {};
  const criadas = { clientes: [], orgs: [], usuarios: [] };

  const org = (nome) => {
    const id = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Plano ${nome} ${sufixo}', 'plano-${nome}-${sufixo}', 'agency') RETURNING id`);
    criadas.orgs.push(id);
    return id;
  };
  const cliente = (organizacao, nome) => {
    const id = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${organizacao}', '${nome} ${sufixo}', 'leads') RETURNING id`);
    criadas.clientes.push(id);
    return id;
  };
  const usuario = (nome) => {
    const id = dono(`INSERT INTO core.users (email, name) VALUES ('plano-${nome}-${sufixo}@tria.local', '${nome}') RETURNING id`);
    criadas.usuarios.push(id);
    return id;
  };
  const membro = (organizacao, quem, papel) =>
    dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${organizacao}', '${quem}', '${papel}') RETURNING id`);

  const novoPlano = (cli = ids.cliA, organizacao = ids.orgA) =>
    dono(`INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key) VALUES ('${organizacao}', '${cli}', 't${randomBytes(3).toString('hex')}') RETURNING id`);
  const statusDe = (id) => dono(`SELECT status FROM core.strategy_plan_versions WHERE id = '${id}'`);

  const doApp = (sql, quem = ids.dono) => comoApp(ids.orgA, '*', quem, sql);
  const doAgente = (sql) => comoWorker(ids.orgA, '*', '', sql);
  const versaoDoUsuario = (plano, extra = {}, quem = ids.dono) => doApp(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, usuario: quem, ...extra }), quem);
  const eventoDoUsuario = (versao, tipo, quem = ids.dono, extra = {}) =>
    doApp(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo, usuario: quem, ...extra }), quem);
  const doWorker = (sql) => comoWorker(ids.orgA, '*', '', sql);
  const eventoDoWorker = (versao, tipo, extra = {}) =>
    doWorker(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo, ator: 'agente', chave: randomBytes(6).toString('hex'), ...extra }));
  const comite = (versao) => {
    eventoDoWorker(versao, 'parecer');
    eventoDoWorker(versao, 'gate');
  };
  const proposto = (plano, extra = {}, quem = ids.dono) => {
    const id = versaoDoUsuario(plano, { status: 'rascunho', usuario: quem, ...extra }, quem);
    comite(id);
    eventoDoUsuario(id, 'proposta', quem);
    return id;
  };
  const vigente = (plano, supersede) => {
    const id = proposto(plano, { supersede });
    eventoDoUsuario(id, 'efetivada');
    return id;
  };
  const eventosDe = (versao, tipo) => dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${versao}' AND kind = '${tipo}'`);

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
    ids.revogado = usuario('revogado');
    ids.donoB = usuario('dono-b');
    ids.naoMembro = usuario('fora');
    membro(ids.orgA, ids.dono, 'owner');
    membro(ids.orgA, ids.admin, 'admin');
    membro(ids.orgA, ids.operador, 'operator');
    membro(ids.orgA, ids.leitor, 'viewer');
    const idRevogado = membro(ids.orgA, ids.revogado, 'owner');
    dono(`UPDATE core.members SET revoked_at = now() WHERE id = '${idRevogado}'`);
    membro(ids.orgB, ids.donoB, 'owner');
  });

  after(() => {
    for (const id of criadas.clientes) dono(`DELETE FROM core.clients WHERE id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.members WHERE user_id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.users WHERE id = '${id}'`);
    for (const id of criadas.orgs) dono(`DELETE FROM core.organizations WHERE id = '${id}'`);
  });

  it('cria plano, versão rascunho e referências na mesma transação, e lê de volta', () => {
    const tipo = `aquisicao${randomBytes(2).toString('hex')}`;
    const plano = randomUUID();
    const versao = randomUUID();
    const urn = `orla:${ids.orgA}:${ids.cliA}:regra:r-1`;
    doApp(
      `INSERT INTO core.strategy_plans (id, organization_id, client_id, plan_type_key) VALUES ('${plano}', '${ids.orgA}', '${ids.cliA}', '${tipo}');` +
        sqlVersao({ id: versao, org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho' }) +
        sqlRef({ org: ids.orgA, cli: ids.cliA, versao, urn, papel: 'evidencia_favor' }),
    );
    assert.equal(doApp(`SELECT status || '/' || schema_version || '/' || author_kind FROM core.strategy_plan_versions WHERE id = '${versao}'`), 'rascunho/1/usuario');
    assert.equal(doApp(`SELECT urn || '/' || content_hash || '/' || role FROM core.strategy_plan_refs WHERE version_id = '${versao}'`), `${urn}/${HASH}/evidencia_favor`);
    const duplicado = recusa(() => dono(`INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key) VALUES ('${ids.orgA}', '${ids.cliA}', '${tipo}')`));
    assert.match(duplicado ?? '', /23505.*strategy_plans_tipo_unico/s);
    assert.match(recusa(() => doApp(`INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key) VALUES ('${ids.orgA}', '${ids.cliA}', 'Maiuscula')`)) ?? '', /23514.*plan_type_key_check/s);
  });

  it('created_at do app é sempre now(): plano e referência não aceitam data retroativa', () => {
    const plano = randomUUID();
    const versao = randomUUID();
    doApp(
      `INSERT INTO core.strategy_plans (id, organization_id, client_id, plan_type_key, created_at) VALUES ('${plano}', '${ids.orgA}', '${ids.cliA}', 'retro${randomBytes(2).toString('hex')}', '2020-01-01');` +
        sqlVersao({ id: versao, org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho' }) +
        `INSERT INTO core.strategy_plan_refs (organization_id, client_id, version_id, urn, content_hash, role, created_at)
         VALUES ('${ids.orgA}', '${ids.cliA}', '${versao}', 'orla:${ids.orgA}:${ids.cliA}:regra:r-9', '${HASH}', 'premissa', '2020-01-01');`,
    );
    assert.equal(dono(`SELECT (created_at > now() - interval '1 hour')::text FROM core.strategy_plans WHERE id = '${plano}'`), 'true');
    assert.equal(dono(`SELECT (created_at > now() - interval '1 hour')::text FROM core.strategy_plan_refs WHERE version_id = '${versao}'`), 'true');
  });

  it('app não faz UPDATE, DELETE, TRUNCATE nem ON CONFLICT DO UPDATE; o dono também não edita nem apaga', () => {
    const plano = novoPlano();
    const versao = proposto(plano);
    for (const tabela of ['strategy_plans', 'strategy_plan_versions', 'strategy_plan_refs', 'strategy_plan_events']) {
      assert.match(recusa(() => doApp(`UPDATE core.${tabela} SET created_at = now()`)) ?? '', /42501.*permission denied/s, `UPDATE ${tabela}`);
      assert.match(recusa(() => doApp(`DELETE FROM core.${tabela}`)) ?? '', /42501.*permission denied/s, `DELETE ${tabela}`);
      assert.match(recusa(() => doApp(`TRUNCATE core.${tabela}`)) ?? '', /42501.*permission denied/s, `TRUNCATE ${tabela}`);
      assert.match(recusa(() => comoWorker(ids.orgA, '*', ids.dono, `UPDATE core.${tabela} SET created_at = now()`)) ?? '', /42501.*permission denied/s, `worker UPDATE ${tabela}`);
    }
    assert.match(
      recusa(() => doApp(`INSERT INTO core.strategy_plans (id, organization_id, client_id, plan_type_key)
        SELECT id, organization_id, client_id, plan_type_key FROM core.strategy_plans WHERE id = '${plano}'
        ON CONFLICT (client_id, plan_type_key) DO UPDATE SET created_at = now()`)) ?? '',
      /42501.*permission denied/s,
    );
    const tipo = dono(`SELECT plan_type_key FROM core.strategy_plans WHERE id = '${plano}'`);
    assert.match(
      recusa(() => doApp(`INSERT INTO core.strategy_plan_versions (id, organization_id, client_id, plan_id, content, schema_version, author_kind, author_user_id)
        SELECT id, organization_id, client_id, plan_id, content, schema_version, author_kind, author_user_id FROM core.strategy_plan_versions WHERE id = '${versao}'
        ON CONFLICT (id) DO UPDATE SET status = 'vigente'`)) ?? '',
      /42501.*permission denied/s,
    );
    assert.equal(tipo.length > 0, true);

    assert.match(recusa(() => dono(`UPDATE core.strategy_plans SET plan_type_key = 'outro' WHERE id = '${plano}'`)) ?? '', /23001.*imutável/s);
    assert.match(recusa(() => dono(`UPDATE core.strategy_plan_versions SET status = 'vigente' WHERE id = '${versao}'`)) ?? '', /23001.*imutável/s);
    assert.match(recusa(() => dono(`UPDATE core.strategy_plan_versions SET content = '{}'::jsonb WHERE id = '${versao}'`)) ?? '', /23001.*imutável/s);
    assert.match(recusa(() => dono(`UPDATE core.strategy_plan_events SET kind = 'ajuste' WHERE version_id = '${versao}'`)) ?? '', /23001.*só de acréscimo/s);
    assert.match(recusa(() => dono(`UPDATE core.strategy_plan_events SET payload = '{}'::jsonb WHERE version_id = '${versao}'`)) ?? '', /23001.*só de acréscimo/s);
    assert.match(recusa(() => dono(`DELETE FROM core.strategy_plan_events WHERE version_id = '${versao}'`)) ?? '', /23001.*não se apaga/s);
    assert.match(recusa(() => dono(`DELETE FROM core.strategy_plan_versions WHERE id = '${versao}'`)) ?? '', /23001.*não se apaga/s);
    assert.match(recusa(() => dono(`DELETE FROM core.strategy_plans WHERE id = '${plano}'`)) ?? '', /23001.*não se apaga/s);
  });

  it('versão nasce sempre rascunho: nenhum outro status passa, e nasce sem evento', () => {
    const plano = novoPlano();
    for (const status of ['proposto', 'vigente', 'superado', 'revogado', 'rejeitado', 'cancelado']) {
      assert.match(recusa(() => versaoDoUsuario(plano, { status })) ?? '', /42501.*versão nasce rascunho/s, status);
      assert.match(recusa(() => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status, autor: 'agente' }))) ?? '', /42501.*versão nasce rascunho/s, `agente ${status}`);
    }
    const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
    assert.equal(statusDe(rascunho), 'rascunho');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${rascunho}'`), '0');
    assert.equal(dono(`SELECT count(*) FROM pg_trigger WHERE tgname = 'strategy_plan_versions_depois'`), '0');
  });

  it('no máximo uma versão aberta por plano: o índice único parcial protege até sem o gatilho', () => {
    const plano = novoPlano();
    const aberta = versaoDoUsuario(plano, { status: 'rascunho' });
    assert.equal(dono(`SELECT indexdef FROM pg_indexes WHERE indexname = 'strategy_plan_versions_uma_aberta'`).includes("status = ANY (ARRAY['rascunho'::text, 'proposto'::text])"), true);
    dono(`ALTER TABLE core.strategy_plan_versions DISABLE TRIGGER strategy_plan_versions_antes`);
    try {
      assert.match(recusa(() => dono(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho' }))) ?? '', /23505.*strategy_plan_versions_uma_aberta/s);
    } finally {
      dono(`ALTER TABLE core.strategy_plan_versions ENABLE TRIGGER strategy_plan_versions_antes`);
    }
    assert.equal(dono(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'strategy_plan_versions_antes'`), 'O');
    assert.equal(statusDe(aberta), 'rascunho');
  });

  it('versão nova cancela a aberta anterior na mesma transação e grava o evento de sistema', () => {
    const plano = novoPlano();
    const primeira = versaoDoUsuario(plano, { status: 'rascunho' });
    const segunda = versaoDoUsuario(plano, { status: 'rascunho' }, ids.operador);
    assert.equal(statusDe(primeira), 'cancelado');
    assert.equal(statusDe(segunda), 'rascunho');
    assert.equal(
      dono(`SELECT actor_kind || '/' || coalesce(actor_user_id::text, 'nulo') || '/' || (payload->>'motivo') || '/' || (payload->>'por') FROM core.strategy_plan_events WHERE version_id = '${primeira}' AND kind = 'cancelada'`),
      `sistema/nulo/substituida_por_edicao/${segunda}`,
    );
    assert.equal(eventosDe(segunda, 'cancelada'), '0');

    const terceira = randomUUID();
    const dentro = doApp(
      sqlVersao({ id: terceira, org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho' }) +
        `SELECT string_agg(id::text || '=' || status, ',' ORDER BY status) FROM core.strategy_plan_versions WHERE id IN ('${segunda}', '${terceira}');`,
    );
    assert.equal(dentro, `${segunda}=cancelado,${terceira}=rascunho`);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE plan_id = '${plano}' AND status IN ('rascunho', 'proposto')`), '1');

    const emAutorizacao = proposto(novoPlano());
    const planoAutorizacao = dono(`SELECT plan_id FROM core.strategy_plan_versions WHERE id = '${emAutorizacao}'`);
    const edicao = versaoDoUsuario(planoAutorizacao, { status: 'rascunho' });
    assert.equal(statusDe(emAutorizacao), 'cancelado');
    assert.equal(statusDe(edicao), 'rascunho');

    const doAgenteNova = doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente' }));
    assert.equal(statusDe(terceira), 'cancelado');
    assert.equal(statusDe(doAgenteNova), 'rascunho');
  });

  it('reenvio idempotente: ON CONFLICT DO NOTHING não cancela a aberta, por id no app e por chave no worker', () => {
    const naoDescarta = (sql) => sql.replace('RETURNING id;', 'ON CONFLICT DO NOTHING RETURNING id;');

    const plano = novoPlano();
    const reenviada = randomUUID();
    doApp(sqlVersao({ id: reenviada, org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho' }));
    const aberta = versaoDoUsuario(plano, { status: 'rascunho' });
    assert.equal(statusDe(reenviada), 'cancelado');
    assert.match(
      recusa(() => doApp(naoDescarta(sqlVersao({ id: reenviada, org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho' })))) ?? '',
      /23505.*versão com este id já existe/s,
    );
    assert.match(
      recusa(() => doApp(naoDescarta(sqlVersao({ id: aberta, org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho' })))) ?? '',
      /23505.*versão com este id já existe/s,
    );
    assert.equal(statusDe(aberta), 'rascunho');
    assert.equal(eventosDe(aberta, 'cancelada'), '0');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE plan_id = '${plano}' AND status IN ('rascunho', 'proposto')`), '1');

    const planoAgente = novoPlano();
    const doAgenteChave = doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano: planoAgente, status: 'rascunho', autor: 'agente', chave: 'reenvio-1' }));
    const abertaDaPessoa = versaoDoUsuario(planoAgente, { status: 'rascunho' });
    assert.equal(statusDe(doAgenteChave), 'cancelado');
    assert.match(
      recusa(() => doAgente(naoDescarta(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano: planoAgente, status: 'rascunho', autor: 'agente', chave: 'reenvio-1' })))) ?? '',
      /23505.*chave de idempotência já usada neste plano/s,
    );
    assert.equal(statusDe(abertaDaPessoa), 'rascunho');
    assert.equal(eventosDe(abertaDaPessoa, 'cancelada'), '0');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE plan_id = '${planoAgente}' AND status IN ('rascunho', 'proposto')`), '1');

    const outroAgente = doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano: planoAgente, status: 'rascunho', autor: 'agente', agente: 'outro-agente', chave: 'reenvio-1' }));
    assert.equal(statusDe(outroAgente), 'rascunho');
    assert.equal(statusDe(abertaDaPessoa), 'cancelado');
  });

  it('cancelar rascunho e proposto: owner, admin e operator; viewer, não membro e pool da web são negados', () => {
    const plano = novoPlano();
    const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
    assert.match(recusa(() => eventoDoUsuario(rascunho, 'cancelada', ids.leitor)) ?? '', /42501.*registrar evento exige papel owner, admin ou operator/s);
    assert.match(recusa(() => eventoDoUsuario(rascunho, 'cancelada', ids.naoMembro)) ?? '', /42501.*não é membro vivo/s);
    assert.match(recusa(() => eventoDoUsuario(rascunho, 'cancelada', ids.revogado)) ?? '', /42501.*não é membro vivo/s);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'cancelada', ator: 'agente' }))) ?? '', /42501.*ator agente só pelo worker/s);
    assert.match(recusa(() => doApp(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'cancelada', ator: 'sistema' }))) ?? '', /42501.*ator sistema só nasce dos gatilhos/s);
    for (const worker of [doWorker, doAgente]) {
      assert.match(recusa(() => worker(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'cancelada', ator: 'sistema' }))) ?? '', /42501.*ator sistema só nasce dos gatilhos/s);
      assert.match(recusa(() => worker(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'redigida', ator: 'sistema' }))) ?? '', /42501.*evento redigida só nasce de core.redigir_plano/s);
    }
    assert.match(recusa(() => doApp(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'redigida', ator: 'sistema' }))) ?? '', /42501.*evento redigida só nasce de core.redigir_plano/s);
    assert.equal(statusDe(rascunho), 'rascunho');

    eventoDoUsuario(rascunho, 'cancelada', ids.operador);
    assert.equal(statusDe(rascunho), 'cancelado');
    assert.match(recusa(() => eventoDoUsuario(rascunho, 'cancelada', ids.dono)) ?? '', /23514.*só rascunho ou proposto pode ser cancelado \(está cancelado\)/s);

    const emAutorizacao = proposto(plano);
    assert.match(recusa(() => eventoDoUsuario(emAutorizacao, 'cancelada', ids.leitor)) ?? '', /42501.*registrar evento exige papel owner, admin ou operator/s);
    eventoDoUsuario(emAutorizacao, 'cancelada', ids.operador);
    assert.equal(statusDe(emAutorizacao), 'cancelado');
    assert.match(recusa(() => eventoDoUsuario(emAutorizacao, 'efetivada', ids.admin)) ?? '', /23514.*transição inválida/s);

    for (const quem of [ids.dono, ids.admin]) {
      const alvo = versaoDoUsuario(plano, { status: 'rascunho' });
      eventoDoUsuario(alvo, 'cancelada', quem);
      assert.equal(statusDe(alvo), 'cancelado');
    }

    const doWorkerAlvo = versaoDoUsuario(plano, { status: 'rascunho' });
    eventoDoWorker(doWorkerAlvo, 'cancelada');
    assert.equal(statusDe(doWorkerAlvo), 'cancelado');

    const propostoDoAgente = proposto(novoPlano());
    const planoDoProposto = dono(`SELECT plan_id FROM core.strategy_plan_versions WHERE id = '${propostoDoAgente}'`);
    assert.match(recusa(() => eventoDoWorker(propostoDoAgente, 'cancelada')) ?? '', /42501.*agente só cancela rascunho/s);
    assert.equal(statusDe(propostoDoAgente), 'proposto');
    const doAgenteSobre = doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano: planoDoProposto, status: 'rascunho', autor: 'agente' }));
    assert.equal(statusDe(propostoDoAgente), 'cancelado');
    assert.equal(statusDe(doAgenteSobre), 'rascunho');
    assert.equal(dono(`SELECT actor_kind || '/' || (payload->>'motivo') || '/' || (payload->>'por') FROM core.strategy_plan_events WHERE version_id = '${propostoDoAgente}' AND kind = 'cancelada'`), `sistema/substituida_por_edicao/${doAgenteSobre}`);

    const vigenteAlvo = vigente(novoPlano());
    assert.match(recusa(() => eventoDoUsuario(vigenteAlvo, 'cancelada', ids.dono)) ?? '', /23514.*só rascunho ou proposto pode ser cancelado \(está vigente\)/s);
    for (const status of ['rejeitado', 'revogado']) {
      const alvo = status === 'rejeitado' ? proposto(novoPlano()) : vigente(novoPlano());
      eventoDoUsuario(alvo, status === 'rejeitado' ? 'rejeitada' : 'revogada');
      assert.match(recusa(() => eventoDoUsuario(alvo, 'cancelada')) ?? '', new RegExp(`23514.*está ${status}`, 's'));
    }
  });

  it('parecer, ajuste e gate só pela credencial do worker: pessoa e pool da web são negados com 42501', () => {
    const plano = novoPlano();
    const base = versaoDoUsuario(plano, { status: 'rascunho' });
    eventoDoWorker(base, 'parecer');
    const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
    const extra = (tipo) => (tipo === 'ajuste' ? { payload: JSON.stringify({ responde_a: base }) } : {});
    for (const tipo of ['parecer', 'ajuste', 'gate']) {
      for (const [nome, quem] of [['owner', ids.dono], ['admin', ids.admin], ['operator', ids.operador], ['viewer', ids.leitor]]) {
        assert.match(recusa(() => eventoDoUsuario(rascunho, tipo, quem, extra(tipo))) ?? '', /42501.*só pela credencial do worker/s, `${nome} ${tipo}`);
      }
      assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo, ator: 'agente', ...extra(tipo) }))) ?? '', /42501.*ator agente só pelo worker/s, `pool da web ${tipo}`);
      assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo, ator: 'agente', ...extra(tipo) }))) ?? '', /42501.*sessão de agente não carrega usuário/s, `agente com usuário ${tipo}`);
      assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo, usuario: ids.dono, ...extra(tipo) }))) ?? '', /42501.*só pela credencial do worker/s, `pool da web como usuário ${tipo}`);
      eventoDoWorker(rascunho, tipo, extra(tipo));
      assert.equal(eventosDe(rascunho, tipo), '1', `worker ${tipo}`);
    }
    assert.equal(statusDe(rascunho), 'rascunho');
  });

  it('parecer, gate e ajuste: payload validado com 23514, parecer único por persona, ajuste único por versão e só em versão rascunho', () => {
    const plano = novoPlano();
    const base = versaoDoUsuario(plano, { status: 'rascunho' });
    eventoDoWorker(base, 'parecer');
    const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
    const parecer = (payload) => eventoDoWorker(rascunho, 'parecer', { payload: JSON.stringify(payload) });
    const ajuste = (payload) => eventoDoWorker(rascunho, 'ajuste', { payload: JSON.stringify(payload) });
    const invalidos = [{}, { veredito: 'aprova' }, { persona: 'x', veredito: 'aprova' }, { persona: 'Risco', veredito: 'aprova' }, { persona: '1risco', veredito: 'aprova' }, { persona: 'risco legal', veredito: 'aprova' },
      { persona: 'a'.repeat(49), veredito: 'aprova' }, { persona: 7, veredito: 'aprova' }, { persona: 'risco' }, { persona: 'risco', veredito: 'talvez' }, { persona: 'risco', veredito: 1 }];
    for (const payload of invalidos) assert.match(recusa(() => parecer(payload)) ?? '', /23514.*parecer exige payload/s, JSON.stringify(payload));
    for (const payload of [{}, { resultado: 'ok' }, { resultado: true }, { resultado: 'Aprovado' }]) {
      assert.match(recusa(() => eventoDoWorker(rascunho, 'gate', { payload: JSON.stringify(payload) })) ?? '', /23514.*gate exige payload.resultado/s, JSON.stringify(payload));
    }
    for (const payload of [{}, { resumo: 'sem alvo' }, { responde_a: 'nao-e-uuid' }, { responde_a: 7 }, { responde_a: null }]) {
      assert.match(recusa(() => ajuste(payload)) ?? '', /23514.*ajuste exige payload.responde_a/s, JSON.stringify(payload));
    }
    assert.match(recusa(() => ajuste({ responde_a: rascunho })) ?? '', /23514.*ajuste não pode responder à própria versão/s);
    assert.equal([eventosDe(rascunho, 'parecer'), eventosDe(rascunho, 'gate'), eventosDe(rascunho, 'ajuste')].join(''), '000');

    for (const [persona, veredito] of [['risco_legal', 'aprova'], ['redator', 'aprova_com_ajuste'], ['ab', 'reprova'], ['a'.repeat(48), 'aprova']]) parecer({ persona, veredito, motivo: 'texto livre' });
    assert.match(recusa(() => parecer({ persona: 'redator', veredito: 'reprova' })) ?? '', /23505.*strategy_plan_events_parecer_persona/s);
    const outra = versaoDoUsuario(novoPlano(), { status: 'rascunho' });
    eventoDoWorker(outra, 'parecer', { payload: '{"persona":"redator","veredito":"aprova"}' });
    assert.equal(eventosDe(rascunho, 'parecer'), '4');

    ajuste({ responde_a: base, resumo: 'corrige a meta' });
    assert.match(recusa(() => ajuste({ responde_a: base })) ?? '', /23505.*strategy_plan_events_um_ajuste/s);
    eventoDoWorker(rascunho, 'gate', { payload: '{"resultado":"reprovado"}' });
    eventoDoWorker(rascunho, 'gate');

    comite(outra);
    eventoDoUsuario(outra, 'proposta');
    const naoRascunho = (versao, estado, tipos = ['parecer', 'ajuste', 'gate']) => {
      for (const tipo of tipos) {
        const payload = tipo === 'parecer' ? '{"persona":"novo","veredito":"aprova"}' : tipo === 'ajuste' ? JSON.stringify({ responde_a: base }) : undefined;
        assert.match(recusa(() => eventoDoWorker(versao, tipo, payload ? { payload } : {})) ?? '', new RegExp(`23514.*só valem em versão rascunho \\(está ${estado}\\)`, 's'), `${estado} ${tipo}`);
      }
    };
    naoRascunho(outra, 'proposto');
    eventoDoUsuario(outra, 'efetivada');
    naoRascunho(outra, 'vigente');
    eventoDoUsuario(rascunho, 'cancelada');
    naoRascunho(rascunho, 'cancelado', ['parecer', 'gate']);
  });

  it('ajuste: responde_a tem de ser a versão que esta substituiu, do mesmo plano, organização e cliente, e ter passado pelo Comitê', () => {
    const plano = novoPlano();
    const semParecer = versaoDoUsuario(plano, { status: 'rascunho' });
    const v2 = versaoDoUsuario(plano, { status: 'rascunho' });
    const invalido = /23514.*ajuste.responde_a precisa ser a versão que esta substituiu, do mesmo plano, e ter passado pelo Comitê/s;
    const ajusteEm = (alvo) => eventoDoWorker(v2, 'ajuste', { payload: JSON.stringify({ responde_a: alvo }) });
    assert.match(recusa(() => ajusteEm(semParecer)) ?? '', invalido, 'versão do plano sem parecer');
    assert.match(recusa(() => ajusteEm(randomUUID())) ?? '', invalido, 'versão inexistente');

    const deOutroPlano = versaoDoUsuario(novoPlano(), { status: 'rascunho' });
    eventoDoWorker(deOutroPlano, 'parecer');
    assert.match(recusa(() => ajusteEm(deOutroPlano)) ?? '', invalido, 'outro plano');

    const planoOutroCliente = novoPlano(ids.cliA2);
    const deOutroCliente = doApp(sqlVersao({ org: ids.orgA, cli: ids.cliA2, plano: planoOutroCliente, usuario: ids.dono, status: 'rascunho' }));
    eventoDoWorker(deOutroCliente, 'parecer', { cli: ids.cliA2 });
    assert.match(recusa(() => ajusteEm(deOutroCliente)) ?? '', invalido, 'outro cliente');

    const orgC = org('c');
    const clienteC = cliente(orgC, 'cli-c');
    const donoC = usuario('dono-c');
    membro(orgC, donoC, 'owner');
    const planoC = dono(`INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key) VALUES ('${orgC}', '${clienteC}', 'ajuste') RETURNING id`);
    const deOutraOrg = comoApp(orgC, '*', donoC, sqlVersao({ org: orgC, cli: clienteC, plano: planoC, usuario: donoC, status: 'rascunho' }));
    comoWorker(orgC, '*', '', sqlEvento({ org: orgC, cli: clienteC, versao: deOutraOrg, tipo: 'parecer', ator: 'agente' }));
    assert.match(recusa(() => ajusteEm(deOutraOrg)) ?? '', invalido, 'outra organização');

    assert.match(recusa(() => ajusteEm(v2)) ?? '', /23514.*ajuste não pode responder à própria versão/s, 'a si mesma');
    assert.equal(eventosDe(v2, 'ajuste'), '0');
  });

  it('trava de aplicar (a): o gate mais recente é aprovado e posterior a todo parecer e ajuste da versão', () => {
    const plano = novoPlano();
    const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
    const propor = (quem = ids.dono) => eventoDoUsuario(rascunho, 'proposta', quem);
    const semNada = recusa(() => propor());
    assert.match(semNada ?? '', /23514.*versão não pode ser proposta: falta parecer do Comitê.* e gate/s);
    assert.doesNotMatch(semNada, new RegExp(`${rascunho}|${plano}`));

    eventoDoWorker(rascunho, 'gate');
    assert.match(recusa(() => propor()) ?? '', /23514.*falta parecer do Comitê/s);

    const soParecer = versaoDoUsuario(novoPlano(), { status: 'rascunho' });
    eventoDoWorker(soParecer, 'parecer');
    assert.match(recusa(() => eventoDoUsuario(soParecer, 'proposta')) ?? '', /23514.*falta gate/s);

    const deOutra = versaoDoUsuario(novoPlano(), { status: 'rascunho' });
    comite(deOutra);
    assert.match(recusa(() => eventoDoUsuario(soParecer, 'proposta')) ?? '', /23514.*falta gate/s);

    eventoDoWorker(rascunho, 'gate', { payload: '{"resultado":"reprovado"}' });
    eventoDoWorker(rascunho, 'parecer', { payload: '{"persona":"risco_legal","veredito":"reprova"}' });
    assert.match(recusa(() => propor()) ?? '', /23514.*falta gate aprovado/s);

    eventoDoWorker(rascunho, 'gate', { payload: '{"resultado":"aprovado"}' });
    eventoDoWorker(rascunho, 'gate', { payload: '{"resultado":"reprovado"}' });
    assert.match(recusa(() => propor()) ?? '', /23514.*falta gate aprovado/s);

    eventoDoWorker(rascunho, 'gate');
    eventoDoWorker(rascunho, 'parecer', { payload: '{"persona":"redator","veredito":"reprova"}' });
    assert.match(recusa(() => propor()) ?? '', /23514.*falta novo gate aprovado depois do último parecer ou ajuste/s);
    assert.equal(statusDe(rascunho), 'rascunho');
    assert.equal(eventosDe(rascunho, 'proposta'), '0');

    eventoDoWorker(rascunho, 'gate');
    assert.match(recusa(() => propor(ids.leitor)) ?? '', /42501.*registrar evento exige papel owner, admin ou operator/s);
    propor(ids.operador);
    assert.equal(statusDe(rascunho), 'proposto');
    assert.equal(eventosDe(rascunho, 'proposta'), '1');
    assert.match(recusa(() => propor()) ?? '', /23514.*não pode ser proposta/s);
  });

  it('trava de aplicar (b): versão sem parecer próprio só passa pelo Comitê com ajuste que responde à versão que substituiu e que passou pelo Comitê', () => {
    const plano = novoPlano();
    const v1 = versaoDoUsuario(plano, { status: 'rascunho' });
    comite(v1);
    const v2 = versaoDoUsuario(plano, { status: 'rascunho' }, ids.operador);
    assert.equal(statusDe(v1), 'cancelado');
    const propor = () => eventoDoUsuario(v2, 'proposta', ids.operador);

    eventoDoWorker(v2, 'gate');
    assert.match(recusa(() => propor()) ?? '', /23514.*falta parecer do Comitê/s);
    assert.match(recusa(() => eventoDoWorker(v2, 'ajuste', { payload: JSON.stringify({ responde_a: v2 }) })) ?? '', /23514.*não pode responder à própria versão/s);

    eventoDoWorker(v2, 'ajuste', { payload: JSON.stringify({ responde_a: v1, resumo: 'acata o parecer de risco' }) });
    assert.match(recusa(() => propor()) ?? '', /23514.*falta novo gate aprovado depois do último parecer ou ajuste/s);
    eventoDoWorker(v2, 'gate');
    propor();
    assert.equal(statusDe(v2), 'proposto');
    assert.equal(eventosDe(v2, 'parecer'), '0');

    const plano2 = novoPlano();
    const w1 = versaoDoUsuario(plano2, { status: 'rascunho' });
    eventoDoWorker(w1, 'parecer');
    const w2 = versaoDoUsuario(plano2, { status: 'rascunho' });
    eventoDoWorker(w2, 'ajuste', { payload: JSON.stringify({ responde_a: w1 }) });
    eventoDoWorker(w2, 'gate', { payload: '{"resultado":"reprovado"}' });
    assert.match(recusa(() => eventoDoUsuario(w2, 'proposta')) ?? '', /23514.*falta gate aprovado/s);
    eventoDoWorker(w2, 'parecer', { payload: '{"persona":"risco_legal","veredito":"reprova"}' });
    eventoDoWorker(w2, 'gate');
    eventoDoUsuario(w2, 'proposta');
    assert.equal(statusDe(w2), 'proposto');
  });

  it('um relógio só: gates na mesma transação ordenam pela trava; a proposta vem antes da cancelada no histórico', () => {
    const plano = novoPlano();
    const bloqueada = versaoDoUsuario(plano, { status: 'rascunho' });
    eventoDoWorker(bloqueada, 'parecer');
    const gate = (versao, resultado) => sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'gate', ator: 'agente', payload: JSON.stringify({ resultado }) });
    doWorker(gate(bloqueada, 'aprovado') + gate(bloqueada, 'reprovado'));
    assert.match(recusa(() => eventoDoUsuario(bloqueada, 'proposta')) ?? '', /23514.*falta gate aprovado/s);
    assert.equal(dono(`SELECT count(DISTINCT created_at) FROM core.strategy_plan_events WHERE version_id = '${bloqueada}' AND kind = 'gate'`), '2');

    const liberada = versaoDoUsuario(plano, { status: 'rascunho' });
    eventoDoWorker(liberada, 'parecer');
    doWorker(gate(liberada, 'reprovado') + gate(liberada, 'aprovado'));
    eventoDoUsuario(liberada, 'proposta');
    assert.equal(statusDe(liberada), 'proposto');

    const nova = versaoDoUsuario(plano, { status: 'rascunho' });
    assert.equal(statusDe(liberada), 'cancelado');
    assert.equal(dono(`SELECT string_agg(kind, ',' ORDER BY created_at, id) FROM core.strategy_plan_events WHERE version_id = '${liberada}'`), 'parecer,gate,gate,proposta,cancelada');
    assert.equal(statusDe(nova), 'rascunho');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE client_id = '${ids.cliA}' AND created_at < now() - interval '1 minute'`), '0');
  });

  it('aplicar é ato de pessoa: o agente não propõe, nem pelo worker nem pelo pool da web', () => {
    const plano = novoPlano();
    const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
    comite(rascunho);
    assert.match(recusa(() => eventoDoWorker(rascunho, 'proposta')) ?? '', /42501.*ato de pessoa/s);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'proposta', ator: 'agente' }))) ?? '', /42501.*ato de pessoa/s);
    assert.match(recusa(() => dono(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'proposta', ator: 'agente' }))) ?? '', /42501.*ato de pessoa/s);
    assert.equal(statusDe(rascunho), 'rascunho');
    eventoDoUsuario(rascunho, 'proposta', ids.admin);
    assert.equal(statusDe(rascunho), 'proposto');
  });

  it('fluxo de editar em autorização: v1 proposto, v2 rascunho cancela v1, Comitê e Gate, proposta, efetivada por admin; depois supersede o vigente', () => {
    const plano = novoPlano();
    const v1 = proposto(plano);
    assert.equal(statusDe(v1), 'proposto');
    const v2 = versaoDoUsuario(plano, { status: 'rascunho' }, ids.operador);
    assert.equal(statusDe(v1), 'cancelado');
    assert.equal(statusDe(v2), 'rascunho');
    assert.match(recusa(() => eventoDoUsuario(v2, 'efetivada', ids.admin)) ?? '', /23514.*transição inválida/s);
    assert.match(recusa(() => eventoDoUsuario(v2, 'proposta', ids.operador)) ?? '', /23514.*falta parecer do Comitê.* e gate/s);
    comite(v2);
    eventoDoUsuario(v2, 'proposta', ids.operador);
    assert.equal(statusDe(v2), 'proposto');
    assert.match(recusa(() => eventoDoUsuario(v1, 'efetivada', ids.admin)) ?? '', /23514.*transição inválida/s);
    assert.match(recusa(() => eventoDoUsuario(v2, 'efetivada', ids.operador)) ?? '', /42501.*exige papel owner ou admin/s);
    eventoDoUsuario(v2, 'efetivada', ids.admin);
    assert.equal(statusDe(v2), 'vigente');
    assert.equal(statusDe(v1), 'cancelado');

    const v3 = proposto(plano, { supersede: v2 });
    assert.equal(statusDe(v2), 'vigente');
    eventoDoUsuario(v3, 'efetivada', ids.dono);
    assert.equal(statusDe(v2), 'superado');
    assert.equal(statusDe(v3), 'vigente');
    assert.equal(dono(`SELECT string_agg(status, ',' ORDER BY created_at, id) FROM core.strategy_plan_versions WHERE plan_id = '${plano}'`).split(',').sort().join(','), 'cancelado,superado,vigente');

    const v4 = versaoDoUsuario(plano, { status: 'rascunho', supersede: v3 });
    const v5 = versaoDoUsuario(plano, { status: 'rascunho', supersede: v3 });
    assert.equal(statusDe(v4), 'cancelado');
    assert.equal(statusDe(v5), 'rascunho');
    assert.equal(statusDe(v3), 'vigente');
  });

  it('plano com vigente exige supersedes_id da vigente; a versão que supera tem de ser a vigente', () => {
    const plano = novoPlano();
    const primeira = proposto(plano);
    eventoDoUsuario(primeira, 'efetivada');
    assert.match(recusa(() => versaoDoUsuario(plano, { status: 'rascunho' })) ?? '', /23514.*já tem versão vigente.*precisa superá-la/s);
    assert.match(recusa(() => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente' }))) ?? '', /23514.*precisa superá-la/s);
    const segunda = versaoDoUsuario(plano, { status: 'rascunho', supersede: primeira });
    assert.match(recusa(() => versaoDoUsuario(plano, { status: 'rascunho', supersede: segunda })) ?? '', /23514.*precisa superá-la/s);
    assert.equal(statusDe(primeira), 'vigente');
    assert.equal(statusDe(segunda), 'rascunho');
  });

  it('agente cria rascunho, dá parecer, ajusta e passa o gate; nunca propõe, efetiva, rejeita ou revoga; usuário aplica e owner efetiva', () => {
    const plano = novoPlano();
    const base = doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', chave: 'k0' }));
    eventoDoWorker(base, 'parecer');
    const rascunho = doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', chave: 'k1' }));
    assert.equal(statusDe(base), 'cancelado');
    assert.equal(statusDe(rascunho), 'rascunho');
    eventoDoWorker(rascunho, 'ajuste', { payload: JSON.stringify({ responde_a: base }) });
    eventoDoWorker(rascunho, 'gate');
    comite(rascunho);

    for (const tipo of ['efetivada', 'rejeitada', 'revogada']) {
      assert.match(recusa(() => doAgente(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo, ator: 'agente' }))) ?? '', /42501.*falta política de autonomia/s, tipo);
      assert.match(recusa(() => dono(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo, ator: 'agente' }))) ?? '', /42501.*falta política de autonomia/s, `dono ${tipo}`);
      assert.match(recusa(() => doApp(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo, ator: 'agente' }))) ?? '', /42501.*falta política de autonomia/s, `app ${tipo}`);
    }
    assert.match(recusa(() => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'vigente', autor: 'agente' }))) ?? '', /42501.*versão nasce rascunho/s);
    assert.match(recusa(() => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'proposto', autor: 'agente' }))) ?? '', /42501.*versão nasce rascunho/s);
    assert.equal(statusDe(rascunho), 'rascunho');

    const doWorkerVersao = comoWorker(ids.orgA, '*', '', sqlVersao({ org: ids.orgA, cli: ids.cliA, plano: novoPlano(), status: 'rascunho', autor: 'agente', agente: 'worker-agente', execucao: 'exec-w' }));
    assert.equal(statusDe(doWorkerVersao), 'rascunho');

    eventoDoUsuario(rascunho, 'proposta');
    assert.equal(statusDe(rascunho), 'proposto');
    eventoDoUsuario(rascunho, 'efetivada');
    assert.equal(statusDe(rascunho), 'vigente');
    eventoDoUsuario(rascunho, 'revogada');
    assert.equal(statusDe(rascunho), 'revogado');
  });

  it('efetivar, rejeitar e revogar exigem owner ou admin vivo; viewer, operator, revogado e não membro são negados', () => {
    const plano = novoPlano();
    const alvo = proposto(plano);
    for (const tipo of ['efetivada', 'rejeitada', 'revogada']) {
      assert.match(recusa(() => eventoDoUsuario(alvo, tipo, ids.operador)) ?? '', /42501.*exige papel owner ou admin/s, `operator ${tipo}`);
      assert.match(recusa(() => eventoDoUsuario(alvo, tipo, ids.leitor)) ?? '', /42501.*registrar evento exige papel owner, admin ou operator/s, `viewer ${tipo}`);
    }
    assert.match(recusa(() => eventoDoUsuario(alvo, 'parecer', ids.operador)) ?? '', /42501.*só pela credencial do worker/s);
    assert.match(recusa(() => eventoDoUsuario(alvo, 'efetivada', ids.revogado)) ?? '', /42501.*não é membro vivo/s);
    assert.match(recusa(() => eventoDoUsuario(alvo, 'efetivada', ids.naoMembro)) ?? '', /42501.*não é membro vivo/s);
    assert.match(recusa(() => versaoDoUsuario(plano, { status: 'rascunho' }, ids.revogado)) ?? '', /42501.*não é membro vivo/s);
    assert.match(recusa(() => eventoDoUsuario(alvo, 'efetivada', ids.dono, { usuario: ids.admin })) ?? '', /42501.*usuário da sessão/s);
    assert.equal(statusDe(alvo), 'proposto');

    eventoDoUsuario(alvo, 'rejeitada', ids.admin);
    assert.equal(statusDe(alvo), 'rejeitado');
    const outro = proposto(plano);
    eventoDoUsuario(outro, 'efetivada', ids.admin);
    assert.equal(statusDe(outro), 'vigente');
    eventoDoUsuario(outro, 'revogada', ids.dono);
    assert.equal(statusDe(outro), 'revogado');
  });

  it('autor usuário só vale com o usuário da sessão e membro vivo; agente exige execução e chave', () => {
    const plano = novoPlano();
    assert.match(recusa(() => versaoDoUsuario(plano, { status: 'rascunho', usuario: ids.naoMembro })) ?? '', /42501.*usuário da sessão/s);
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.naoMembro, sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', usuario: ids.naoMembro }))) ?? '', /42501.*não é membro vivo/s);
    assert.match(recusa(() => doApp(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente' }))) ?? '', /42501.*sessão de agente não carrega usuário/s);
    assert.match(
      recusa(() => dono(`INSERT INTO core.strategy_plan_versions (organization_id, client_id, plan_id, content, schema_version, author_kind) VALUES ('${ids.orgA}', '${ids.cliA}', '${plano}', '{}'::jsonb, 1, 'usuario')`)) ?? '',
      /23514.*(autor usuario exige author_user_id|strategy_plan_versions_autor)/s,
    );
    const base = `INSERT INTO core.strategy_plan_versions (organization_id, client_id, plan_id, content, schema_version, author_kind`;
    const comum = `'${ids.orgA}', '${ids.cliA}', '${plano}', '{}'::jsonb, 1, 'agente'`;
    assert.match(recusa(() => dono(`${base}, agent_id) VALUES (${comum}, 'x')`)) ?? '', /23514.*strategy_plan_versions_autor/s);
    assert.match(recusa(() => dono(`${base}, agent_id, agent_run_id) VALUES (${comum}, 'x', '${tokenDeExecucao('r', plano)}')`)) ?? '', /23514.*strategy_plan_versions_autor/s);
    assert.match(recusa(() => dono(`INSERT INTO core.strategy_plan_versions (organization_id, client_id, plan_id, content, schema_version, author_kind, author_user_id, idempotency_key) VALUES ('${ids.orgA}', '${ids.cliA}', '${plano}', '{}'::jsonb, 1, 'usuario', '${ids.dono}', 'k')`)) ?? '', /23514.*strategy_plan_versions_autor/s);
    assert.match(recusa(() => dono(`INSERT INTO core.strategy_plan_events (organization_id, client_id, version_id, kind, actor_kind, actor_user_id, agent_id) VALUES ('${ids.orgA}', '${ids.cliA}', '${versaoDoUsuario(plano, { status: 'rascunho' })}', 'impacto_anotado', 'usuario', '${ids.dono}', 'x')`)) ?? '', /23514.*strategy_plan_events_agente/s);
  });

  it('superar marca a anterior superado na mesma transação', () => {
    const plano = novoPlano();
    const anterior = vigente(plano);
    const nova = proposto(plano, { supersede: anterior });
    assert.equal(statusDe(anterior), 'vigente');

    const dentro = doApp(
      sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: nova, tipo: 'efetivada', usuario: ids.dono }) +
        `SELECT string_agg(id::text || '=' || status, ',' ORDER BY status) FROM core.strategy_plan_versions WHERE id IN ('${anterior}', '${nova}');`,
    );
    assert.equal(dentro, `${anterior}=superado,${nova}=vigente`);

    const outroPlano = novoPlano();
    assert.match(recusa(() => versaoDoUsuario(outroPlano, { status: 'rascunho', supersede: nova })) ?? '', /23000.*não existe neste plano/s);
    assert.match(recusa(() => versaoDoUsuario(plano, { status: 'rascunho', supersede: anterior })) ?? '', /23514.*precisa superá-la/s);
  });

  it('concorrência real: efetivar a candidata e criar outra versão sobre a mesma vigente, uma vence e a outra falha; duas edições seguidas deixam uma só aberta', async () => {
    const plano = novoPlano();
    const base = vigente(plano);
    const candidata = proposto(plano, { supersede: base });
    const rodar = (quem, sql) => executar('docker', argumentos('orla_app', variavel('APP_DB_PASSWORD'), contexto(ids.orgA, '*', quem) + sql + 'SELECT pg_sleep(1.5);'), { encoding: 'utf8' });
    const efetivando = rodar(ids.dono, sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: candidata, tipo: 'efetivada', usuario: ids.dono }));
    await new Promise((resolver) => setTimeout(resolver, 500));
    const concorrente = rodar(ids.dono, sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho', supersede: base }));
    const resultados = await Promise.allSettled([efetivando, concorrente]);
    assert.equal(resultados[0].status, 'fulfilled');
    assert.equal(resultados[1].status, 'rejected');
    assert.match(String(resultados[1].reason.stderr), /23514.*precisa superá-la/s);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE plan_id = '${plano}' AND status = 'vigente'`), '1');
    assert.equal(statusDe(base), 'superado');
    assert.equal(statusDe(candidata), 'vigente');

    const outro = novoPlano();
    const primeira = rodar(ids.dono, sqlVersao({ org: ids.orgA, cli: ids.cliA, plano: outro, usuario: ids.dono, status: 'rascunho' }));
    await new Promise((resolver) => setTimeout(resolver, 500));
    const segunda = rodar(ids.operador, sqlVersao({ org: ids.orgA, cli: ids.cliA, plano: outro, usuario: ids.operador, status: 'rascunho' }));
    const duplas = await Promise.allSettled([primeira, segunda]);
    for (const resultado of duplas) assert.equal(resultado.status, 'fulfilled', String(resultado.reason?.stderr));
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE plan_id = '${outro}' AND status IN ('rascunho', 'proposto')`), '1');
    assert.equal(dono(`SELECT string_agg(status, ',' ORDER BY status) FROM core.strategy_plan_versions WHERE plan_id = '${outro}'`), 'cancelado,rascunho');
  });

  it('transições inválidas são recusadas; parecer não muda status', () => {
    const plano = novoPlano();
    const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
    for (const tipo of ['efetivada', 'rejeitada', 'revogada']) {
      assert.match(recusa(() => eventoDoUsuario(rascunho, tipo)) ?? '', /23514.*transição inválida/s, tipo);
    }
    assert.match(recusa(() => eventoDoUsuario(rascunho, 'proposta')) ?? '', /23514.*falta parecer do Comitê.* e gate/s);
    comite(rascunho);
    assert.equal(statusDe(rascunho), 'rascunho');
    eventoDoUsuario(rascunho, 'proposta');
    assert.equal(statusDe(rascunho), 'proposto');
    assert.match(recusa(() => eventoDoUsuario(rascunho, 'proposta')) ?? '', /23514.*não pode ser proposta/s);
    eventoDoUsuario(rascunho, 'rejeitada');
    assert.equal(statusDe(rascunho), 'rejeitado');
    assert.match(recusa(() => eventoDoUsuario(rascunho, 'efetivada')) ?? '', /23514.*transição inválida/s);
    assert.match(recusa(() => eventoDoUsuario(rascunho, 'proposta')) ?? '', /23514.*não pode ser proposta/s);
    eventoDoUsuario(rascunho, 'impacto_anotado', ids.dono, { payload: '{"resumo":"ok"}' });
    assert.equal(statusDe(rascunho), 'rejeitado');
    assert.match(recusa(() => eventoDoUsuario(rascunho, 'redigida')) ?? '', /42501.*só nasce de core.redigir_plano/s);
  });

  it('isolamento: outra organização e cliente fora do escopo não leem nem inserem, sem vazar nem travar', () => {
    const plano = novoPlano();
    const versao = proposto(plano);
    const tabelas = ['strategy_plans', 'strategy_plan_versions', 'strategy_plan_refs', 'strategy_plan_events'];
    const comRef = randomUUID();
    const planoRef = novoPlano();
    doApp(
      sqlVersao({ id: comRef, org: ids.orgA, cli: ids.cliA, plano: planoRef, usuario: ids.dono, status: 'rascunho' }) +
        sqlRef({ org: ids.orgA, cli: ids.cliA, versao: comRef, urn: `orla:${ids.orgA}:${ids.cliA}:regra:r-iso` }) +
        sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: comRef, tipo: 'impacto_anotado', usuario: ids.dono }),
    );
    for (const tabela of tabelas) {
      assert.equal(comoApp(ids.orgB, '*', ids.donoB, `SELECT count(*) FROM core.${tabela}`), '0', `${tabela} vazaria para a organização B`);
      assert.notEqual(comoApp(ids.orgA, '*', ids.dono, `SELECT count(*) FROM core.${tabela}`), '0', `${tabela} some para a própria organização`);
      assert.equal(comoApp(ids.orgA, ids.cliA2, ids.dono, `SELECT count(*) FROM core.${tabela} WHERE client_id = '${ids.cliA}'`), '0', `${tabela} vaza cliente fora do escopo`);
      assert.equal(psql('orla_app', variavel('APP_DB_PASSWORD'), `SELECT count(*) FROM core.${tabela}`), '0', `${tabela} sem contexto`);
    }

    const fora = /42501.*organização ou cliente fora do contexto da sessão/s;
    assert.match(recusa(() => comoApp(ids.orgB, '*', ids.donoB, `INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key) VALUES ('${ids.orgA}', '${ids.cliA}', 'invasor')`)) ?? '', fora);
    assert.match(recusa(() => comoApp(ids.orgB, '*', ids.donoB, `INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key) VALUES ('${ids.orgB}', '${ids.cliA}', 'invasor')`)) ?? '', fora);
    assert.match(recusa(() => comoApp(ids.orgA, ids.cliA2, ids.dono, `INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key) VALUES ('${ids.orgA}', '${ids.cliA}', 'fora_do_escopo')`)) ?? '', fora);
    assert.match(recusa(() => comoApp(ids.orgA, ids.cliA2, ids.dono, sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho' }))) ?? '', fora);
    assert.match(recusa(() => comoApp(ids.orgA, ids.cliA2, ids.dono, sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'impacto_anotado', usuario: ids.dono }))) ?? '', fora);
    assert.match(recusa(() => comoApp(ids.orgA, ids.cliA2, ids.dono, sqlRef({ org: ids.orgA, cli: ids.cliA, versao: comRef, urn: `orla:${ids.orgA}:${ids.cliA}:regra:r-x` }))) ?? '', fora);
    assert.match(
      recusa(() => comoApp(ids.orgB, '*', ids.donoB, sqlVersao({ org: ids.orgB, cli: ids.cliB, plano, usuario: ids.donoB, status: 'rascunho', supersede: versao }))) ?? '',
      /23000.*plano inexistente neste cliente/s,
    );
    assert.match(recusa(() => comoApp(ids.orgB, '*', ids.donoB, sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'efetivada', usuario: ids.donoB }))) ?? '', fora);
    assert.match(recusa(() => comoApp(ids.orgB, '*', ids.donoB, sqlEvento({ org: ids.orgB, cli: ids.cliB, versao, tipo: 'impacto_anotado', usuario: ids.donoB }))) ?? '', /23503.*strategy_plan_events_versao_fk/s);
    assert.equal(statusDe(versao), 'proposto');
  });

  it('URN malformado ou de outro cliente, hash fora do formato e papel inválido são recusados', () => {
    const plano = novoPlano();
    const tentar = (urn, hash = HASH, papel = 'premissa') => {
      const versao = randomUUID();
      return doApp(
        sqlVersao({ id: versao, org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho' }) + sqlRef({ org: ids.orgA, cli: ids.cliA, versao, urn, hash, papel }),
      );
    };
    const falhas = ['urn-qualquer', `orla:${ids.orgA}:${ids.cliA}:regra`, `orla:${ids.orgA}:${ids.cliA}:Regra:r-1`, `urn:${ids.orgA}:${ids.cliA}:regra:r-1`, `orla:${ids.orgA}:${ids.cliA}:regra:`];
    for (const urn of falhas) assert.match(recusa(() => tentar(urn)) ?? '', /23514.*strategy_plan_refs_urn_check/s, urn);
    assert.match(recusa(() => tentar(`orla:${ids.orgA}:${ids.cliA2}:regra:r-1`)) ?? '', /23514.*strategy_plan_refs_urn_do_inquilino/s);
    assert.match(recusa(() => tentar(`orla:${ids.orgB}:${ids.cliA}:regra:r-1`)) ?? '', /23514.*strategy_plan_refs_urn_do_inquilino/s);
    for (const hash of ['', '   ', 'abc123', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      assert.match(recusa(() => tentar(`orla:${ids.orgA}:${ids.cliA}:regra:r-1`, hash)) ?? '', /23514.*strategy_plan_refs_content_hash_check/s, `hash "${hash}"`);
    }
    assert.match(recusa(() => tentar(`orla:${ids.orgA}:${ids.cliA}:regra:r-1`, HASH, 'opiniao')) ?? '', /23514.*strategy_plan_refs_role_check/s);
    const versao = randomUUID();
    const urn = `orla:${ids.orgA}:${ids.cliA}:regra:r-1`;
    doApp(sqlVersao({ id: versao, org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho' }) + sqlRef({ org: ids.orgA, cli: ids.cliA, versao, urn }));
    assert.match(recusa(() => dono(`UPDATE core.strategy_plan_refs SET content_hash = '${'b'.repeat(64)}' WHERE version_id = '${versao}'`)) ?? '', /23001.*imutável/s);
    assert.match(recusa(() => dono(sqlRef({ org: ids.orgA, cli: ids.cliA, versao, urn }))) ?? '', /23001.*só entra na transação que criou a versão/s);
    const duplicada = randomUUID();
    assert.match(
      recusa(() => doApp(sqlVersao({ id: duplicada, org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho' }) + sqlRef({ org: ids.orgA, cli: ids.cliA, versao: duplicada, urn }) + sqlRef({ org: ids.orgA, cli: ids.cliA, versao: duplicada, urn }))) ?? '',
      /23505.*strategy_plan_refs_unica/s,
    );
  });

  it('referência só entra na transação que criou a versão', () => {
    const plano = novoPlano();
    const versao = versaoDoUsuario(plano, { status: 'rascunho' });
    assert.match(recusa(() => dono(sqlRef({ org: ids.orgA, cli: ids.cliA, versao, urn: `orla:${ids.orgA}:${ids.cliA}:regra:tardia` }))) ?? '', /23001.*só entra na transação que criou a versão/s);
  });

  it('idempotência: chave repetida do mesmo agente no mesmo plano é recusada; outro plano, outro agente e outro evento passam', () => {
    const plano = novoPlano();
    doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', chave: 'chave-1' }));
    assert.match(recusa(() => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', chave: 'chave-1' }))) ?? '', /23505.*strategy_plan_versions_idempotencia/s);
    doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano: novoPlano(), status: 'rascunho', autor: 'agente', chave: 'chave-1' }));
    doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', agente: 'outro-agente', chave: 'chave-1' }));
    assert.match(recusa(() => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', chave: 'chave com espaço' }))) ?? '', /23514.*idempotency_key_check/s);

    const versao = doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', chave: 'chave-2' }));
    const parecer = { org: ids.orgA, cli: ids.cliA, versao, tipo: 'parecer', ator: 'agente', chave: 'ev-1' };
    doAgente(sqlEvento(parecer));
    assert.match(recusa(() => doAgente(sqlEvento(parecer))) ?? '', /23505.*strategy_plan_events_idempotencia/s);
    doAgente(sqlEvento({ ...parecer, chave: 'ev-2' }));
  });

  it('teto de escrita do agente por execução e por cliente em 24 h, com o papel do worker (ORT01 e ORT02; padrão 100 e 1000)', () => {
    const cli = cliente(ids.orgA, 'cli-teto');
    const plano = novoPlano(cli);
    const versao = (execucao, extra = '') =>
      comoWorker(ids.orgA, '*', '', `${extra}${sqlVersao({ org: ids.orgA, cli, plano, status: 'rascunho', autor: 'agente', execucao })}`);

    const reduz = 'SET orla.teto_agente_por_execucao = 2; ';
    versao('run-a', reduz);
    versao('run-a', reduz);
    assert.match(recusa(() => versao('run-a', reduz)) ?? '', /ORT01.*teto de versões do agente por execução/s);
    versao('run-b', reduz);

    assert.match(recusa(() => versao('run-c', 'SET orla.teto_agente_por_dia = 3; ')) ?? '', /ORT02.*teto diário de versões/s);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE client_id = '${cli}'`), '3');

    const cli3 = cliente(ids.orgA, 'cli-teto-teto');
    const plano3 = novoPlano(cli3);
    const amplia = `SET orla.teto_agente_por_execucao = 9999; SET orla.teto_agente_por_dia = 99999; `;
    assert.match(
      recusa(() => comoWorker(ids.orgA, '*', '', `${amplia}
        DO $$ BEGIN PERFORM set_config('orla.ficha_execucao', '1', true); FOR i IN 1..101 LOOP
          INSERT INTO core.strategy_plan_versions (organization_id, client_id, plan_id, content, schema_version, author_kind, agent_id, agent_run_id, idempotency_key)
          VALUES ('${ids.orgA}', '${cli3}', '${plano3}', '{}'::jsonb, 1, 'agente', 'comite', '${garantirExecucao('run-massa', plano3)}', 'k' || i);
        END LOOP; END $$;`)) ?? '',
      /ORT01.*teto de versões do agente por execução atingido \(100\)/s,
      'o GUC só reduz o teto, nunca o amplia',
    );
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE client_id = '${cli3}'`), '0');

    const cli2 = cliente(ids.orgA, 'cli-teto-ev');
    const plano2 = novoPlano(cli2);
    const rascunho = comoWorker(ids.orgA, '*', '', sqlVersao({ org: ids.orgA, cli: cli2, plano: plano2, status: 'rascunho', autor: 'agente', execucao: 'run-v' }));
    const gateDoAgente = (execucao, extra = '') =>
      comoWorker(ids.orgA, '*', '', `${extra}${sqlEvento({ org: ids.orgA, cli: cli2, versao: rascunho, tipo: 'gate', ator: 'agente', execucao, chave: randomBytes(5).toString('hex') })}`);
    gateDoAgente('run-e', reduz);
    gateDoAgente('run-e', reduz);
    assert.match(recusa(() => gateDoAgente('run-e', reduz)) ?? '', /ORT01.*teto de eventos do agente por execução/s);
    assert.match(recusa(() => gateDoAgente('run-f', 'SET orla.teto_agente_por_dia = 2; ')) ?? '', /ORT02.*teto diário de eventos/s);

    const runMassaEv = garantirExecucao('run-massa-ev', plano2);
    assert.match(
      recusa(() => comoWorker(ids.orgA, '*', '', `${amplia}
        DO $$ BEGIN PERFORM set_config('orla.ficha_execucao', '1', true); FOR i IN 1..101 LOOP
          INSERT INTO core.strategy_plan_events (organization_id, client_id, version_id, kind, actor_kind, agent_id, agent_run_id, idempotency_key, payload)
          VALUES ('${ids.orgA}', '${cli2}', '${rascunho}', 'gate', 'agente', 'comite', '${runMassaEv}', 'e' || i, '{"resultado":"aprovado"}'::jsonb);
        END LOOP; END $$;`)) ?? '',
      /ORT01.*teto de eventos do agente por execução atingido \(100\)/s,
      'o GUC só reduz o teto de eventos, nunca o amplia',
    );
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE client_id = '${cli2}' AND agent_run_id = '${runMassaEv}'`), '0');
  });

  it('redação LGPD: só o worker executa, segue a cadeia nos dois sentidos e cobre content e payload', () => {
    const plano = novoPlano();
    const primeira = vigente(plano);
    const segunda = vigente(plano, primeira);
    const terceira = vigente(plano, segunda);
    const alheio = novoPlano();
    const alheiaVersao = versaoDoUsuario(alheio, { status: 'rascunho', conteudo: '{"segredo":"mantido"}' });
    eventoDoUsuario(segunda, 'impacto_anotado', ids.dono, { payload: '{"resumo":"texto livre"}' });

    assert.match(recusa(() => doApp(`SELECT core.redigir_plano('${segunda}', 'pedido do titular')`)) ?? '', /42501.*permission denied for function redigir_plano/s);
    assert.match(recusa(() => comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${segunda}', 'x')`)) ?? '', /23514.*motivo da redação obrigatório/s);
    assert.match(recusa(() => comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${randomUUID()}', 'pedido do titular')`)) ?? '', /P0002.*versão inexistente/s);

    comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${segunda}', 'pedido do titular')`);
    for (const id of [primeira, segunda, terceira]) {
      assert.equal(dono(`SELECT (content = '{"redigido": true}'::jsonb AND redacted_at IS NOT NULL)::text FROM core.strategy_plan_versions WHERE id = '${id}'`), 'true', `versão ${id}`);
      assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${id}' AND kind <> 'redigida' AND payload <> '{"redigido": true}'::jsonb`), '0', `payload dos eventos de ${id}`);
      assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${id}' AND kind = 'redigida'`), '1', `evento redigida de ${id}`);
    }
    assert.equal(dono(`SELECT status FROM core.strategy_plan_versions WHERE id = '${terceira}'`), 'vigente');
    assert.equal(dono(`SELECT content::text FROM core.strategy_plan_versions WHERE id = '${alheiaVersao}'`), '{"segredo": "mantido"}');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${alheiaVersao}'`), '0');

    comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${primeira}', 'repetida')`);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${primeira}' AND kind = 'redigida'`), '1');

    assert.match(recusa(() => dono(`UPDATE core.strategy_plan_versions SET content = '{"redigido": true}'::jsonb, redacted_at = now() WHERE id = '${alheiaVersao}'`)) ?? '', /23001.*imutável/s);
    assert.match(recusa(() => comoWorker(ids.orgA, '*', '', `UPDATE core.strategy_plan_versions SET content = '{"redigido": true}'::jsonb WHERE id = '${alheiaVersao}'`)) ?? '', /42501.*permission denied/s);
  });

  it('exclusão de usuário zera author_user_id e actor_user_id antes de o cliente sumir', () => {
    const autor = usuario('autor-apagado');
    membro(ids.orgA, autor, 'owner');
    const plano = novoPlano();
    const versao = proposto(plano, { usuario: autor }, autor);
    assert.equal(dono(`SELECT author_user_id FROM core.strategy_plan_versions WHERE id = '${versao}'`), autor);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${versao}' AND actor_user_id = '${autor}'`), '1');
    dono(`DELETE FROM core.members WHERE user_id = '${autor}'`);
    dono(`DELETE FROM core.users WHERE id = '${autor}'`);
    assert.equal(dono(`SELECT coalesce(author_user_id::text, 'nulo') FROM core.strategy_plan_versions WHERE id = '${versao}'`), 'nulo');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${versao}' AND actor_user_id IS NULL AND actor_kind = 'usuario'`), '1');
    assert.equal(statusDe(versao), 'proposto');
    eventoDoUsuario(versao, 'efetivada');
    assert.equal(statusDe(versao), 'vigente');
  });

  it('expurgo do cliente leva plano, versões em cadeia, referências e eventos', () => {
    const cli = cliente(ids.orgA, 'expurgo');
    const plano = randomUUID();
    const v1 = randomUUID();
    const v2 = randomUUID();
    const urn = `orla:${ids.orgA}:${cli}:regra:r-1`;
    const comiteSql = (versao) =>
      sqlEvento({ org: ids.orgA, cli, versao, tipo: 'parecer', ator: 'agente', execucao: 'run-exp' }) + sqlEvento({ org: ids.orgA, cli, versao, tipo: 'gate', ator: 'agente', execucao: 'run-exp' });
    dono(
      `INSERT INTO core.strategy_plans (id, organization_id, client_id, plan_type_key) VALUES ('${plano}', '${ids.orgA}', '${cli}', 'marca');` +
        sqlVersao({ id: v1, org: ids.orgA, cli, plano, usuario: ids.dono, status: 'rascunho' }) +
        sqlRef({ org: ids.orgA, cli, versao: v1, urn, papel: 'evidencia_contra' }),
    );
    dono(comiteSql(v1) + sqlEvento({ org: ids.orgA, cli, versao: v1, tipo: 'proposta', usuario: ids.dono }));
    dono(sqlEvento({ org: ids.orgA, cli, versao: v1, tipo: 'efetivada', usuario: ids.dono }));
    dono(
      sqlVersao({ id: v2, org: ids.orgA, cli, plano, usuario: ids.dono, status: 'rascunho', supersede: v1 }) +
        sqlRef({ org: ids.orgA, cli, versao: v2, urn: `orla:${ids.orgA}:${cli}:regra:r-2` }),
    );
    dono(comiteSql(v2) + sqlEvento({ org: ids.orgA, cli, versao: v2, tipo: 'proposta', usuario: ids.dono }));
    dono(sqlEvento({ org: ids.orgA, cli, versao: v2, tipo: 'efetivada', usuario: ids.dono }));
    const contar = () =>
      dono(`SELECT (SELECT count(*) FROM core.strategy_plans WHERE client_id = '${cli}') || '/' || (SELECT count(*) FROM core.strategy_plan_versions WHERE client_id = '${cli}')
            || '/' || (SELECT count(*) FROM core.strategy_plan_refs WHERE client_id = '${cli}') || '/' || (SELECT count(*) FROM core.strategy_plan_events WHERE client_id = '${cli}')`);
    assert.equal(contar(), '1/2/2/8');
    assert.equal(statusDe(v1), 'superado');
    dono(`DELETE FROM core.clients WHERE id = '${cli}'`);
    assert.equal(contar(), '0/0/0/0');
  });

  it('viewer é negado ao criar plano, versão e evento; operator cria', () => {
    const planoId = randomUUID();
    assert.match(
      recusa(() => doApp(`INSERT INTO core.strategy_plans (id, organization_id, client_id, plan_type_key) VALUES ('${planoId}', '${ids.orgA}', '${ids.cliA}', 'leitor')`, ids.leitor)) ?? '',
      /42501.*criar plano exige papel owner, admin ou operator/s,
    );
    const plano = novoPlano();
    assert.match(recusa(() => versaoDoUsuario(plano, { status: 'rascunho', usuario: ids.leitor }, ids.leitor)) ?? '', /42501.*criar versão exige papel owner, admin ou operator/s);
    const versao = versaoDoUsuario(plano, { status: 'rascunho' });
    assert.match(recusa(() => eventoDoUsuario(versao, 'proposta', ids.leitor)) ?? '', /42501.*registrar evento exige papel owner, admin ou operator/s);
    assert.match(recusa(() => eventoDoUsuario(versao, 'cancelada', ids.leitor)) ?? '', /42501.*registrar evento exige papel owner, admin ou operator/s);
    assert.match(recusa(() => eventoDoUsuario(versao, 'parecer', ids.leitor)) ?? '', /42501.*só pela credencial do worker/s);
    assert.equal(statusDe(versao), 'rascunho');

    doApp(`INSERT INTO core.strategy_plans (id, organization_id, client_id, plan_type_key) VALUES ('${planoId}', '${ids.orgA}', '${ids.cliA}', 'operador')`, ids.operador);
    const doOperador = versaoDoUsuario(planoId, { status: 'rascunho', usuario: ids.operador }, ids.operador);
    comite(doOperador);
    eventoDoUsuario(doOperador, 'proposta', ids.operador);
    assert.equal(statusDe(doOperador), 'proposto');
  });

  it('organização B com recorte "*" e cliente de A: 42501 em planos, versões e eventos, nunca o teto nem erro de outro inquilino', () => {
    const planoA = novoPlano();
    const vigenteA = vigente(planoA);
    const fora = /42501.*organização ou cliente fora do contexto da sessão/s;
    const zero = 'SET orla.teto_agente_por_execucao = 0; SET orla.teto_agente_por_dia = 0; ';
    const comoB = (sql) => comoApp(ids.orgB, '*', ids.donoB, sql);
    const agenteB = (sql) => comoWorker(ids.orgB, '*', '', zero + sql);

    assert.match(recusa(() => comoB(`INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key) VALUES ('${ids.orgB}', '${ids.cliA}', 'invasor')`)) ?? '', fora);
    for (const org of [ids.orgA, ids.orgB]) {
      assert.match(recusa(() => agenteB(sqlVersao({ org, cli: ids.cliA, plano: planoA, status: 'rascunho', autor: 'agente' }))) ?? '', fora, `versão de agente org ${org === ids.orgA ? 'A' : 'B'}`);
      assert.match(recusa(() => comoB(sqlVersao({ org, cli: ids.cliA, plano: planoA, usuario: ids.donoB, status: 'rascunho' }))) ?? '', fora, `versão de usuário org ${org === ids.orgA ? 'A' : 'B'}`);
      assert.match(recusa(() => agenteB(sqlEvento({ org, cli: ids.cliA, versao: vigenteA, tipo: 'parecer', ator: 'agente' }))) ?? '', fora, `evento de agente org ${org === ids.orgA ? 'A' : 'B'}`);
      assert.match(recusa(() => comoB(sqlEvento({ org, cli: ids.cliA, versao: vigenteA, tipo: 'parecer', usuario: ids.donoB }))) ?? '', fora, `evento de usuário org ${org === ids.orgA ? 'A' : 'B'}`);
      assert.match(recusa(() => comoB(sqlRef({ org, cli: ids.cliA, versao: vigenteA, urn: `orla:${org}:${ids.cliA}:regra:r-b` }))) ?? '', fora, `ref org ${org === ids.orgA ? 'A' : 'B'}`);
    }
  });

  it('plano de outro inquilino: erro genérico, sem UUID nem status, mesmo com versão vigente no plano', () => {
    const planoA = novoPlano();
    const vigenteA = vigente(planoA);
    const erros = [
      recusa(() => comoApp(ids.orgB, '*', ids.donoB, sqlVersao({ org: ids.orgB, cli: ids.cliB, plano: planoA, usuario: ids.donoB, status: 'rascunho' }))),
      recusa(() => comoApp(ids.orgB, ids.cliB, ids.donoB, sqlVersao({ org: ids.orgB, cli: ids.cliB, plano: planoA, usuario: ids.donoB, status: 'rascunho', supersede: vigenteA }))),
      recusa(() => comoWorker(ids.orgB, '*', '', sqlVersao({ org: ids.orgB, cli: ids.cliB, plano: planoA, status: 'rascunho', autor: 'agente' }))),
    ];
    for (const erro of erros) {
      assert.match(erro ?? '', /23000.*plano inexistente neste cliente/s);
      assert.doesNotMatch(erro, new RegExp(`${planoA}|${vigenteA}|vigente`));
    }
  });

  it('redação é idempotente e alcança evento gravado depois dela', () => {
    const plano = novoPlano();
    const primeira = vigente(plano);
    const segunda = vigente(plano, primeira);
    comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${segunda}', 'pedido do titular')`);
    const redigidas = () => dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id IN ('${primeira}', '${segunda}') AND kind = 'redigida'`);
    assert.equal(redigidas(), '2');

    const tardio = (versao, texto) =>
      dono(
        `ALTER TABLE core.strategy_plan_events DISABLE TRIGGER strategy_plan_events_antes;ALTER TABLE core.strategy_plan_events DISABLE TRIGGER strategy_plan_events_b_teto;` +
          sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'impacto_anotado', usuario: ids.dono, payload: JSON.stringify({ resumo: texto }) }) +
          `ALTER TABLE core.strategy_plan_events ENABLE TRIGGER strategy_plan_events_antes;ALTER TABLE core.strategy_plan_events ENABLE TRIGGER strategy_plan_events_b_teto;`,
      );
    tardio(segunda, 'texto livre posterior');
    tardio(primeira, 'outro texto');
    assert.equal(dono(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'strategy_plan_events_antes'`), 'O');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id IN ('${primeira}', '${segunda}') AND kind = 'impacto_anotado' AND payload <> '{"redigido": true}'::jsonb`), '2');

    comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${primeira}', 'de novo')`);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id IN ('${primeira}', '${segunda}') AND kind <> 'redigida' AND payload <> '{"redigido": true}'::jsonb`), '0');
    assert.equal(redigidas(), '2');
    comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${primeira}', 'outra vez')`);
    assert.equal(redigidas(), '2');
  });

  it('app e worker não alcançam a exceção de redação por GUC', () => {
    const plano = novoPlano();
    const versao = versaoDoUsuario(plano, { status: 'rascunho' });
    eventoDoUsuario(versao, 'impacto_anotado', ids.dono, { payload: '{"resumo":"x"}' });
    const marca = `SET orla.redigindo_plano = '${versao}'; `;
    const versoes = `UPDATE core.strategy_plan_versions SET content = '{"redigido": true}'::jsonb, redacted_at = now() WHERE id = '${versao}'`;
    const eventos = `UPDATE core.strategy_plan_events SET payload = '{"redigido": true}'::jsonb WHERE version_id = '${versao}'`;
    for (const executa of [(sql) => doApp(marca + sql), (sql) => comoWorker(ids.orgA, '*', ids.dono, marca + sql)]) {
      assert.match(recusa(() => executa(versoes)) ?? '', /42501.*permission denied/s);
      assert.match(recusa(() => executa(eventos)) ?? '', /42501.*permission denied/s);
    }
    assert.equal(dono(`SELECT content::text FROM core.strategy_plan_versions WHERE id = '${versao}'`), '{"intencao": {"horizonte": "12m"}}');
  });

  it('ordem única de travas: eventos do worker na versão que o usuário propõe e substitui por edição, sem deadlock', async () => {
    const plano = novoPlano();
    const candidata = versaoDoUsuario(plano, { status: 'rascunho' });
    comite(candidata);
    const agenteNaCandidata = (indice, tipo) =>
      executar('docker', argumentos('orla_worker', variavel('WORKER_DB_PASSWORD'), contexto(ids.orgA, '*', '') + sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: candidata, tipo, ator: 'agente', execucao: 'run-par', chave: `par-${indice}-${randomBytes(3).toString('hex')}` })), { encoding: 'utf8' });
    const transacaoDoUsuario = executar(
      'docker',
      argumentos(
        'orla_app',
        variavel('APP_DB_PASSWORD'),
        contexto(ids.orgA, '*', ids.dono) +
          sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: candidata, tipo: 'proposta', usuario: ids.dono }) +
          'SELECT pg_sleep(4.7);' +
          sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho' }),
      ),
      { encoding: 'utf8' },
    );
    await esperarSessaoDormindo('pg_sleep(4.7)');
    const resultados = await Promise.allSettled([transacaoDoUsuario, agenteNaCandidata(0, 'parecer'), agenteNaCandidata(1, 'gate')]);
    assert.equal(resultados[0].status, 'fulfilled', String(resultados[0].reason?.stderr));
    for (const resultado of resultados.slice(1)) {
      assert.equal(resultado.status, 'rejected');
      assert.match(String(resultado.reason.stderr), /23514.*só valem em versão rascunho \(está cancelado\)/s);
      assert.doesNotMatch(String(resultado.reason.stderr), /40P01/);
    }
    assert.equal(statusDe(candidata), 'cancelado');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE plan_id = '${plano}' AND status = 'rascunho'`), '1');
    assert.equal(eventosDe(candidata, 'proposta'), '1');
    assert.equal(eventosDe(candidata, 'cancelada'), '1');
  });

  it('passagem pelo Comitê em cadeia: v1 (pareceres) → v2 (ajuste responde v1) → v3 (ajuste responde v2) é aceita', () => {
    const plano = novoPlano();
    const novaDoAgente = (chave) => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', chave }));
    const v1 = novaDoAgente('c1');
    eventoDoWorker(v1, 'parecer');
    const v2 = novaDoAgente('c2');
    eventoDoWorker(v2, 'ajuste', { payload: JSON.stringify({ responde_a: v1 }) });
    eventoDoWorker(v2, 'gate', { payload: '{"resultado":"reprovado"}' });
    const v3 = novaDoAgente('c3');
    assert.equal(statusDe(v2), 'cancelado');
    eventoDoWorker(v3, 'ajuste', { payload: JSON.stringify({ responde_a: v2 }) });
    eventoDoWorker(v3, 'gate');
    eventoDoUsuario(v3, 'proposta');
    assert.equal(statusDe(v3), 'proposto');
    assert.equal(eventosDe(v3, 'parecer'), '0');
  });

  it('versão antiga do plano não empresta parecer a uma revisão nova: ajuste só responde à versão substituída', () => {
    const plano = novoPlano();
    const novaDoAgente = (chave) => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', chave }));
    const v1 = novaDoAgente('a1');
    eventoDoWorker(v1, 'parecer');
    const v2 = novaDoAgente('a2');
    eventoDoWorker(v2, 'ajuste', { payload: JSON.stringify({ responde_a: v1 }) });
    const v3 = novaDoAgente('a3');
    eventoDoWorker(v3, 'ajuste', { payload: JSON.stringify({ responde_a: v2 }) });
    const v4 = novaDoAgente('a4');
    eventoDoWorker(v4, 'ajuste', { payload: JSON.stringify({ responde_a: v3 }) });
    const v5 = novaDoAgente('a5');
    const invalido = /23514.*ajuste.responde_a precisa ser a versão que esta substituiu/s;
    assert.match(recusa(() => eventoDoWorker(v5, 'ajuste', { payload: JSON.stringify({ responde_a: v1 }) })) ?? '', invalido, 'versão antiga com parecer');
    assert.match(recusa(() => eventoDoWorker(v5, 'ajuste', { payload: JSON.stringify({ responde_a: v2 }) })) ?? '', invalido, 'versão intermediária');
    eventoDoWorker(v5, 'gate');
    assert.match(recusa(() => eventoDoUsuario(v5, 'proposta')) ?? '', /23514.*falta parecer do Comitê/s);
    eventoDoWorker(v5, 'ajuste', { payload: JSON.stringify({ responde_a: v4 }) });
    eventoDoWorker(v5, 'gate');
    eventoDoUsuario(v5, 'proposta');
    assert.equal(statusDe(v5), 'proposto');
  });

  it('cadeia sem parecer na raiz é recusada, e a cadeia tem no máximo 10 saltos', () => {
    const semRaiz = novoPlano();
    const nova = (plano, chave) => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', chave }));
    const r1 = nova(semRaiz, 's1');
    const r2 = nova(semRaiz, 's2');
    assert.match(recusa(() => eventoDoWorker(r2, 'ajuste', { payload: JSON.stringify({ responde_a: r1 }) })) ?? '', /23514.*ter passado pelo Comitê/s);

    const longo = novoPlano();
    let anterior = nova(longo, 'l0');
    eventoDoWorker(anterior, 'parecer');
    for (let i = 1; i <= 11; i += 1) {
      const atual = nova(longo, `l${i}`);
      eventoDoWorker(atual, 'ajuste', { payload: JSON.stringify({ responde_a: anterior }) });
      anterior = atual;
    }
    const aposDezSaltos = nova(longo, 'l12');
    assert.match(recusa(() => eventoDoWorker(aposDezSaltos, 'ajuste', { payload: JSON.stringify({ responde_a: anterior }) })) ?? '', /23514.*ter passado pelo Comitê/s);
  });

  it('reenvio idempotente de versão recebe 23505 antes do teto do agente e da regra da vigente', () => {
    const plano = novoPlano();
    const criar = (chave, extra = {}, prefixo = '') => doAgente(prefixo + sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', execucao: 'run-idem', chave, ...extra }));
    const original = criar('idem-1');
    assert.match(recusa(() => criar('idem-1', {}, "SET orla.teto_agente_por_execucao = '1'; ")) ?? '', /23505.*strategy_plan_versions_idempotencia/s, 'com o teto da execução estourado');
    assert.match(recusa(() => criar('idem-1', {}, "SET orla.teto_agente_por_dia = '1'; ")) ?? '', /23505.*strategy_plan_versions_idempotencia/s, 'com o teto diário estourado');
    assert.match(recusa(() => criar('idem-2', {}, "SET orla.teto_agente_por_execucao = '1'; ")) ?? '', /ORT01/s, 'chave nova continua sob o teto');
    assert.equal(statusDe(original), 'rascunho', 'reenvio não cancela a aberta');

    comite(original);
    eventoDoUsuario(original, 'proposta');
    eventoDoUsuario(original, 'efetivada');
    assert.equal(statusDe(original), 'vigente');
    assert.match(recusa(() => criar('idem-1')) ?? '', /23505.*strategy_plan_versions_idempotencia/s, 'com vigente e sem supersedes_id');
    assert.match(recusa(() => criar('idem-3')) ?? '', /23514.*já tem versão vigente/s, 'chave nova sem supersedes_id continua recusada');
    assert.match(recusa(() => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', id: original, chave: 'idem-9' }))) ?? '', /23505.*strategy_plan_versions_pkey/s);
  });

  it('corrida evento × redação: o payload não vazio que esperava a trava é recusado depois da redação', async () => {
    const plano = novoPlano();
    const versao = versaoDoUsuario(plano, { status: 'rascunho' });
    const redacao = executar(
      'docker',
      argumentos('orla_worker', variavel('WORKER_DB_PASSWORD'), contexto(ids.orgA, '*', '') + `BEGIN; SELECT core.redigir_plano('${versao}', 'pedido do titular'); SELECT pg_sleep(4.3); COMMIT;`),
      { encoding: 'utf8' },
    );
    await esperarSessaoDormindo('pg_sleep(4.3)');
    const evento = executar(
      'docker',
      argumentos('orla_worker', variavel('WORKER_DB_PASSWORD'), contexto(ids.orgA, '*', '') + sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'parecer', ator: 'agente', payload: '{"persona":"risco","veredito":"aprova","motivo":"texto livre"}' })),
      { encoding: 'utf8' },
    );
    const [feita, tentativa] = await Promise.allSettled([redacao, evento]);
    assert.equal(feita.status, 'fulfilled', String(feita.reason?.stderr));
    assert.equal(tentativa.status, 'rejected');
    assert.match(String(tentativa.reason.stderr), /23514.*versão redigida só aceita evento com payload vazio/s);
    assert.equal(eventosDe(versao, 'parecer'), '0');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${versao}' AND payload::text LIKE '%texto livre%'`), '0');
  });

  it('relógio único: proposta e cancelada de sistema na mesma transação saem em ordem de created_at, sem depender do id', () => {
    for (let rodada = 0; rodada < 5; rodada += 1) {
      const plano = novoPlano();
      const candidata = versaoDoUsuario(plano, { status: 'rascunho' });
      comite(candidata);
      doApp(
        sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: candidata, tipo: 'proposta', usuario: ids.dono }) +
          sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho' }),
      );
      assert.equal(statusDe(candidata), 'cancelado');
      const ordem = dono(`SELECT string_agg(kind, ',' ORDER BY created_at, id) FROM core.strategy_plan_events WHERE version_id = '${candidata}'`);
      assert.equal(ordem, 'parecer,gate,proposta,cancelada', `rodada ${rodada}`);
      assert.equal(
        dono(`SELECT (count(DISTINCT created_at) = count(*))::text FROM core.strategy_plan_events WHERE version_id = '${candidata}'`),
        'true',
        'cada evento tem o seu instante',
      );
    }
  });

  it('o pool da web sem usuário (orla_app, app.user_id vazio) não escreve nem como agente nem pulando o papel', () => {
    const plano = novoPlano();
    const versao = versaoDoUsuario(plano, { status: 'rascunho' });
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', `INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key) VALUES ('${ids.orgA}', '${ids.cliA}', 'sem_usuario')`)) ?? '', /42501.*sessão sem usuário só vale para o worker/s);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente' }))) ?? '', /42501.*autor agente só pelo worker/s);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'parecer', ator: 'agente' }))) ?? '', /42501.*ator agente só pelo worker/s);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'proposta', ator: 'agente' }))) ?? '', /42501.*ato de pessoa/s);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'cancelada', ator: 'agente' }))) ?? '', /42501.*ator agente só pelo worker/s);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', usuario: ids.dono }))) ?? '', /42501.*usuário da sessão/s);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'impacto_anotado', usuario: ids.dono }))) ?? '', /42501.*usuário da sessão/s);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${versao}'`), '0');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plans WHERE plan_type_key = 'sem_usuario'`), '0');
  });

  it('versão redigida só aceita evento com payload vazio; parecer, ajuste e gate não passam por ela', () => {
    const plano = novoPlano();
    const versao = versaoDoUsuario(plano, { status: 'rascunho' });
    comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${versao}', 'pedido do titular')`);
    assert.match(recusa(() => eventoDoUsuario(versao, 'impacto_anotado', ids.dono, { payload: '{"resumo":"texto livre"}' })) ?? '', /23514.*versão redigida só aceita evento com payload vazio/s);
    for (const tipo of ['parecer', 'ajuste', 'gate', 'cancelada']) {
      assert.match(recusa(() => eventoDoWorker(versao, tipo, { payload: '{"resumo":"texto","persona":"risco","veredito":"aprova","resultado":"aprovado"}' })) ?? '', /23514.*payload vazio/s, `${tipo} com texto`);
    }
    for (const tipo of ['parecer', 'ajuste', 'gate']) {
      assert.match(recusa(() => eventoDoWorker(versao, tipo, { payload: '{}' })) ?? '', /23514.*(parecer|ajuste|gate) exige payload/s, `${tipo} vazio`);
    }
    eventoDoUsuario(versao, 'impacto_anotado');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${versao}' AND kind = 'impacto_anotado' AND payload = '{}'::jsonb`), '1');

    const sucessora = versaoDoUsuario(plano, { status: 'rascunho' });
    assert.equal(statusDe(versao), 'cancelado');
    assert.equal(dono(`SELECT payload::text FROM core.strategy_plan_events WHERE version_id = '${versao}' AND kind = 'cancelada'`), '{}');
    assert.equal(statusDe(sucessora), 'rascunho');
  });

  it('redação LGPD alcança todas as versões do plano, com ou sem supersedes_id, inclusive o cancelada de sistema', () => {
    const plano = novoPlano();
    const v1 = versaoDoUsuario(plano, { status: 'rascunho', conteudo: '{"segredo":"v1"}' });
    eventoDoWorker(v1, 'parecer', { payload: '{"persona":"risco","veredito":"aprova","motivo":"texto livre"}' });
    const v2 = versaoDoUsuario(plano, { status: 'rascunho', conteudo: '{"segredo":"v2"}' });
    eventoDoUsuario(v2, 'impacto_anotado', ids.dono, { payload: '{"resumo":"texto livre"}' });
    assert.equal(statusDe(v1), 'cancelado');
    assert.equal(dono(`SELECT payload->>'motivo' FROM core.strategy_plan_events WHERE version_id = '${v1}' AND kind = 'cancelada'`), 'substituida_por_edicao');
    const alheio = versaoDoUsuario(novoPlano(), { status: 'rascunho', conteudo: '{"segredo":"mantido"}' });

    const conferir = (versoes) => {
      for (const id of versoes) {
        assert.equal(dono(`SELECT (content = '{"redigido": true}'::jsonb AND redacted_at IS NOT NULL)::text FROM core.strategy_plan_versions WHERE id = '${id}'`), 'true', `versão ${id}`);
        assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${id}' AND kind <> 'redigida' AND payload <> '{"redigido": true}'::jsonb`), '0', `payload dos eventos de ${id}`);
        assert.equal(eventosDe(id, 'redigida'), '1', `evento redigida de ${id}`);
      }
    };
    comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${v2}', 'pedido do titular')`);
    conferir([v1, v2]);
    assert.equal(dono(`SELECT payload::text FROM core.strategy_plan_events WHERE version_id = '${v1}' AND kind = 'cancelada'`), '{"redigido": true}');
    assert.equal(dono(`SELECT content::text FROM core.strategy_plan_versions WHERE id = '${alheio}'`), '{"segredo": "mantido"}');
    comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${v1}', 'repetida')`);
    conferir([v1, v2]);

    const plano2 = novoPlano();
    const vigenteAntes = vigente(plano2);
    eventoDoUsuario(vigenteAntes, 'revogada');
    const depoisDaRevogada = versaoDoUsuario(plano2, { status: 'rascunho', conteudo: '{"segredo":"novo"}' });
    assert.equal(dono(`SELECT supersedes_id IS NULL FROM core.strategy_plan_versions WHERE id = '${depoisDaRevogada}'`), 't');
    comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${depoisDaRevogada}', 'pedido do titular')`);
    conferir([vigenteAntes, depoisDaRevogada]);
    assert.equal(statusDe(vigenteAntes), 'revogado');
  });

  it('privilégios: nenhuma função DEFINER strategy_plan_* é executável pelo app; redigir_plano só pelo worker; RLS forçada', () => {
    const executaveis = (papel) =>
      dono(
        `SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'core' AND p.prosecdef AND (p.proname LIKE 'strategy\\_plan\\_%' OR p.proname = 'redigir_plano') AND has_function_privilege('${papel}', p.oid, 'EXECUTE')`,
      );
    assert.equal(executaveis('orla_app'), '');
    assert.equal(executaveis('orla_worker'), 'redigir_plano');
    for (const papel of ['orla_app', 'orla_worker']) {
      for (const tabela of ['strategy_plans', 'strategy_plan_versions', 'strategy_plan_refs', 'strategy_plan_events']) {
        assert.equal(
          dono(`SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege('${papel}', 'core.${tabela}', p)`),
          'INSERT,SELECT',
          `${papel} em ${tabela}`,
        );
      }
    }
    assert.equal(
      dono(`SELECT bool_and(relrowsecurity AND relforcerowsecurity)::text FROM pg_class WHERE oid IN ('core.strategy_plans'::regclass, 'core.strategy_plan_versions'::regclass, 'core.strategy_plan_refs'::regclass, 'core.strategy_plan_events'::regclass)`),
      'true',
    );
  });
  const sqlExecucaoDireta = ({ org = ids.orgA, cli = ids.cliA, plano, run, status = 'rodando', lease = "now() + interval '1 hour'" }) =>
    dono(
      `INSERT INTO core.strategy_plan_runs (organization_id, client_id, plan_id, kind, pedido, agent_run_id, requested_kind, status, etapa, tentativas, lease_until)
       VALUES ('${org}', '${cli}', '${plano}', 'revisar', '{"motivo":"brain_mudou"}'::jsonb, '${run}', 'sistema', '${status}', '${status === 'concluida' ? 'fim' : 'redigir'}', 1, ${lease}) RETURNING id`,
    );
  const cancelarExecucaoComoPessoa = (execucaoId, quem = ids.operador) =>
    comoApp(ids.orgA, '*', quem, `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${execucaoId}' RETURNING status;`);
  const ESCRITA_SEM_EXECUCAO = /42501.*escrita de agente exige execução ativa/s;

  it('escrita de agente exige execução ativa do MESMO plano, organização e cliente: cancelada, concluída, lease vencido, outro plano, outro cliente e inexistente são 42501', () => {
    const plano = novoPlano();
    const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
    const outroPlano = novoPlano();
    const planoDeOutroCliente = novoPlano(ids.cliA2);

    const cancelada = `run-cancelada-${sufixo}`;
    cancelarExecucaoComoPessoa(sqlExecucaoDireta({ plano, run: cancelada }));
    const concluida = `run-concluida-${sufixo}`;
    const idConcluida = sqlExecucaoDireta({ plano, run: concluida });
    comoWorker(ids.orgA, '*', '', `UPDATE core.strategy_plan_runs SET status = 'concluida', etapa = 'fim' WHERE id = '${idConcluida}'`);
    const vencida = `run-vencida-${sufixo}`;
    const idVencida = sqlExecucaoDireta({ plano, run: vencida, lease: "now() - interval '1 minute'" });
    assert.equal(dono(`SELECT status || '/' || (lease_until < now())::text FROM core.strategy_plan_runs WHERE id = '${idVencida}'`), 'rodando/true', 'rodando, mas com o lease vencido de verdade');
    const deOutroPlano = `run-outro-plano-${sufixo}`;
    sqlExecucaoDireta({ plano: outroPlano, run: deOutroPlano });
    const deOutroCliente = `run-outro-cliente-${sufixo}`;
    sqlExecucaoDireta({ cli: ids.cliA2, plano: planoDeOutroCliente, run: deOutroCliente });

    for (const run of [cancelada, concluida, vencida, deOutroPlano, deOutroCliente, `run-inexistente-${sufixo}`]) {
      assert.match(recusa(() => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', execucaoExata: run }))) ?? '', ESCRITA_SEM_EXECUCAO, `versão com ${run}`);
      for (const tipo of ['parecer', 'gate']) {
        assert.match(recusa(() => doWorker(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo, ator: 'agente', execucaoExata: run, chave: randomBytes(4).toString('hex') }))) ?? '', ESCRITA_SEM_EXECUCAO, `${tipo} com ${run}`);
      }
    }
    assert.equal(statusDe(rascunho), 'rascunho');
    assert.equal(eventosDe(rascunho, 'parecer'), '0');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE plan_id = '${plano}' AND author_kind = 'agente'`), '0');
  });

  it('lease vencido de execução ainda rodando recusa a escrita do agente; renovado, ela volta a valer', () => {
    const plano = novoPlano();
    const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
    const run = `run-lease-${sufixo}`;
    const id = sqlExecucaoDireta({ plano, run, lease: "now() - interval '1 minute'" });
    const parecerComRun = () => doWorker(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'parecer', ator: 'agente', execucaoExata: run, chave: randomBytes(4).toString('hex') }));
    assert.match(recusa(parecerComRun) ?? '', ESCRITA_SEM_EXECUCAO);
    comoWorker(ids.orgA, '*', '', `UPDATE core.strategy_plan_runs SET status = 'rodando', tentativas = tentativas + 1, lease_until = now() + interval '5 minutes' WHERE id = '${id}'`);
    parecerComRun();
    assert.equal(eventosDe(rascunho, 'parecer'), '1');
  });

  it('pessoa cancela a execução R durante o redigir e edita à mão: a escrita atrasada de R é recusada e a edição manual sobrevive', () => {
    const plano = novoPlano();
    const run = `run-R-${sufixo}`;
    const idR = sqlExecucaoDireta({ plano, run });
    const resultado = (tipo = 'parecer', versao) => doWorker(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo, ator: 'agente', execucaoExata: run, chave: randomBytes(4).toString('hex') }));
    const doAgenteAntes = doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', execucaoExata: run }));
    assert.equal(statusDe(doAgenteAntes), 'rascunho');

    assert.equal(cancelarExecucaoComoPessoa(idR), 'cancelada');
    const manual = versaoDoUsuario(plano, { status: 'rascunho' }, ids.operador);
    assert.equal(statusDe(doAgenteAntes), 'cancelado');
    assert.equal(statusDe(manual), 'rascunho');

    assert.match(recusa(() => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', execucaoExata: run }))) ?? '', ESCRITA_SEM_EXECUCAO);
    assert.match(recusa(() => resultado('parecer', manual)) ?? '', ESCRITA_SEM_EXECUCAO);
    assert.match(recusa(() => resultado('gate', manual)) ?? '', ESCRITA_SEM_EXECUCAO);
    assert.equal(statusDe(manual), 'rascunho', 'a edição manual não foi cancelada pela escrita atrasada');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE plan_id = '${plano}' AND status = 'rascunho'`), '1');
    assert.equal(eventosDe(manual, 'parecer') + eventosDe(manual, 'gate'), '00');
  });

  it('ordem dos gatilhos: o de execução vem depois do de inquilino e de autoridade e antes do que cancela a aberta e conta o teto', () => {
    const ordem = (tabela) =>
      dono(`SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'core.${tabela}'::regclass AND NOT tgisinternal AND tgtype & 2 = 2 AND tgtype & 4 = 4`);
    assert.equal(
      ordem('strategy_plan_versions'),
      'strategy_plan_versions_a0_inquilino,strategy_plan_versions_a_autoridade,strategy_plan_versions_a_execucao,strategy_plan_versions_antes',
    );
    assert.equal(
      ordem('strategy_plan_events'),
      'strategy_plan_events_a0_inquilino,strategy_plan_events_antes,strategy_plan_events_antes_execucao,strategy_plan_events_b_teto',
    );
  });

  it('evento de sistema e de pessoa não dependem de execução; a trava de sistema do cancelamento continua valendo', () => {
    const plano = novoPlano();
    const primeira = versaoDoUsuario(plano, { status: 'rascunho' });
    const segunda = versaoDoUsuario(plano, { status: 'rascunho' }, ids.operador);
    assert.equal(statusDe(primeira), 'cancelado');
    assert.equal(statusDe(segunda), 'rascunho');
    eventoDoUsuario(segunda, 'cancelada', ids.operador);
    assert.equal(statusDe(segunda), 'cancelado');
  });

  it('pessoa cancelando a execução × agente gravando, nos dois sentidos, sem deadlock', async () => {
    for (const quemComeca of ['agente', 'pessoa']) {
      const plano = novoPlano();
      const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
      const run = `run-par-${quemComeca}-${sufixo}`;
      const idR = sqlExecucaoDireta({ plano, run });
      const marca = `pg_sleep(3.${quemComeca === 'agente' ? 1 : 2})`;
      const agente = (comEspera) =>
        executar(
          'docker',
          argumentos(
            'orla_worker',
            variavel('WORKER_DB_PASSWORD'),
            contexto(ids.orgA, '*', '') +
              sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'parecer', ator: 'agente', execucaoExata: run, chave: randomBytes(4).toString('hex') }) +
              (comEspera ? `SELECT ${marca};` : ''),
          ),
          { encoding: 'utf8' },
        );
      const pessoa = (comEspera) =>
        executar(
          'docker',
          argumentos(
            'orla_app',
            variavel('APP_DB_PASSWORD'),
            contexto(ids.orgA, '*', ids.operador) + `UPDATE core.strategy_plan_runs SET status = 'cancelada' WHERE id = '${idR}';` + (comEspera ? `SELECT ${marca};` : ''),
          ),
          { encoding: 'utf8' },
        );
      const primeira = quemComeca === 'agente' ? agente(true) : pessoa(true);
      await esperarSessaoDormindo(marca);
      const segunda = quemComeca === 'agente' ? pessoa(false) : agente(false);
      const [a, b] = await Promise.allSettled([primeira, segunda]);
      const agenteResultado = quemComeca === 'agente' ? a : b;
      const pessoaResultado = quemComeca === 'agente' ? b : a;
      assert.equal(pessoaResultado.status, 'fulfilled', String(pessoaResultado.reason?.stderr));
      assert.equal(dono(`SELECT status FROM core.strategy_plan_runs WHERE id = '${idR}'`), 'cancelada');
      if (quemComeca === 'agente') {
        assert.equal(agenteResultado.status, 'fulfilled', String(agenteResultado.reason?.stderr));
        assert.equal(eventosDe(rascunho, 'parecer'), '1', 'a escrita que leu a linha primeiro vale e a pessoa espera');
      } else {
        assert.equal(agenteResultado.status, 'rejected');
        assert.match(String(agenteResultado.reason.stderr), ESCRITA_SEM_EXECUCAO);
        assert.equal(eventosDe(rascunho, 'parecer'), '0', 'cancelada primeiro: a escrita seguinte é recusada');
      }
      for (const r of [a, b]) if (r.status === 'rejected') assert.doesNotMatch(String(r.reason.stderr), /40P01|deadlock/i);
    }
  });

  it('pessoa editando à mão × agente gravando, nos dois sentidos, sem deadlock', async () => {
    for (const quemComeca of ['agente', 'pessoa']) {
      const plano = novoPlano();
      const run = `run-edicao-${quemComeca}-${sufixo}`;
      sqlExecucaoDireta({ plano, run });
      const aberta = doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', execucaoExata: run }));
      const marca = `pg_sleep(3.${quemComeca === 'agente' ? 3 : 4})`;
      const agente = (comEspera) =>
        executar(
          'docker',
          argumentos(
            'orla_worker',
            variavel('WORKER_DB_PASSWORD'),
            contexto(ids.orgA, '*', '') +
              sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: aberta, tipo: 'parecer', ator: 'agente', execucaoExata: run, chave: randomBytes(4).toString('hex') }) +
              (comEspera ? `SELECT ${marca};` : ''),
          ),
          { encoding: 'utf8' },
        );
      const pessoa = (comEspera) =>
        executar(
          'docker',
          argumentos(
            'orla_app',
            variavel('APP_DB_PASSWORD'),
            contexto(ids.orgA, '*', ids.operador) + sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, usuario: ids.operador, status: 'rascunho' }) + (comEspera ? `SELECT ${marca};` : ''),
          ),
          { encoding: 'utf8' },
        );
      const primeira = quemComeca === 'agente' ? agente(true) : pessoa(true);
      await esperarSessaoDormindo(marca);
      const segunda = quemComeca === 'agente' ? pessoa(false) : agente(false);
      const [a, b] = await Promise.allSettled([primeira, segunda]);
      const agenteResultado = quemComeca === 'agente' ? a : b;
      const pessoaResultado = quemComeca === 'agente' ? b : a;
      assert.equal(pessoaResultado.status, 'fulfilled', String(pessoaResultado.reason?.stderr));
      assert.equal(statusDe(aberta), 'cancelado');
      if (quemComeca === 'agente') {
        assert.equal(agenteResultado.status, 'fulfilled', String(agenteResultado.reason?.stderr));
        assert.equal(eventosDe(aberta, 'parecer'), '1');
      } else {
        assert.equal(agenteResultado.status, 'rejected');
        assert.match(String(agenteResultado.reason.stderr), /23514.*só valem em versão rascunho \(está cancelado\)/s);
      }
      for (const r of [a, b]) if (r.status === 'rejected') assert.doesNotMatch(String(r.reason.stderr), /40P01|deadlock/i);
      assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE plan_id = '${plano}' AND status = 'rascunho'`), '1');
    }
  });

  it('chave de idempotência já usada e parecer repetido da mesma persona viram 23505 ANTES do teto, e o evento novo continua sob o teto', () => {
    const plano = novoPlano();
    const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
    const run = `run-idem-ev-${sufixo}`;
    sqlExecucaoDireta({ plano, run });
    const evento = (extra = {}, prefixo = '') =>
      doWorker(prefixo + sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'parecer', ator: 'agente', execucaoExata: run, ...extra }));
    const estoura = "SET orla.teto_agente_por_execucao = '1'; ";
    evento({ chave: 'ev-idem-1', payload: '{"persona":"redator","veredito":"aprova"}' });
    assert.match(
      recusa(() => evento({ chave: 'ev-idem-1', payload: '{"persona":"publicitario","veredito":"aprova"}' }, estoura)) ?? '',
      /23505.*strategy_plan_events_idempotencia/s,
      'a mesma chave com o teto da execução estourado',
    );
    assert.match(
      recusa(() => evento({ chave: 'ev-idem-2', payload: '{"persona":"redator","veredito":"aprova"}' }, estoura)) ?? '',
      /23505.*strategy_plan_events_parecer_persona/s,
      'a mesma persona com o teto da execução estourado',
    );
    assert.match(recusa(() => evento({ chave: 'ev-idem-3', payload: '{"persona":"buzz","veredito":"aprova"}' }, estoura)) ?? '', /ORT01/s, 'evento novo continua sob o teto');
    assert.match(
      recusa(() => evento({ chave: 'ev-idem-4', payload: '{"persona":"redator","veredito":"aprova"}' }, "SET orla.teto_agente_por_dia = '1'; ")) ?? '',
      /23505.*strategy_plan_events_parecer_persona/s,
      'e com o teto diário',
    );
    assert.equal(eventosDe(rascunho, 'parecer'), '1');
  });

  describe('cadeia do Comitê de UMA execução só (ADR 0065 §4, achado 6)', () => {
    const novaVersaoDoAgente = (plano, run, chave) => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', execucao: run, chave }));
    const evento = (versao, tipo, run, payload) => eventoDoWorker(versao, tipo, { execucao: run, ...(payload ? { payload: JSON.stringify(payload) } : {}) });
    const invalido = /23514.*ter passado pelo Comitê na mesma execução/s;

    it('V3 (R1, ligada a V1 com os 9 pareceres) → mudança abre R2 → V4 cancela V3 → ajuste em V4 respondendo V3 é recusado; a cadeia de R1 continua aceita', () => {
      const plano = novoPlano();
      const v1 = novaVersaoDoAgente(plano, 'rodada-R1', 'a1');
      evento(v1, 'parecer', 'rodada-R1');
      const v3 = novaVersaoDoAgente(plano, 'rodada-R1', 'a3');
      evento(v3, 'ajuste', 'rodada-R1', { responde_a: v1 });
      evento(v3, 'gate', 'rodada-R1');
      const v4 = novaVersaoDoAgente(plano, 'rodada-R2', 'a4');
      assert.equal(statusDe(v3), 'cancelado');
      assert.match(recusa(() => evento(v4, 'ajuste', 'rodada-R2', { responde_a: v3 })) ?? '', invalido);
      assert.equal(eventosDe(v4, 'ajuste'), '0');
    });

    it('a cadeia legítima da mesma execução continua aceita, e dois ajustes seguidos também', () => {
      const plano = novoPlano();
      const v1 = novaVersaoDoAgente(plano, 'mesma-R', 'b1');
      evento(v1, 'parecer', 'mesma-R');
      const v2 = novaVersaoDoAgente(plano, 'mesma-R', 'b2');
      evento(v2, 'ajuste', 'mesma-R', { responde_a: v1 });
      const v3 = novaVersaoDoAgente(plano, 'mesma-R', 'b3');
      evento(v3, 'ajuste', 'mesma-R', { responde_a: v2 });
      evento(v3, 'gate', 'mesma-R');
      assert.equal(eventosDe(v3, 'ajuste'), '1');
    });

    it('raiz de autor pessoa com pareceres da execução corrente é aceita; pareceres de outra execução, não', () => {
      const plano = novoPlano();
      const editada = versaoDoUsuario(plano, { status: 'rascunho' });
      evento(editada, 'parecer', 'revisao-corrente');
      const ajustada = novaVersaoDoAgente(plano, 'revisao-corrente', 'c1');
      evento(ajustada, 'ajuste', 'revisao-corrente', { responde_a: editada });
      evento(ajustada, 'gate', 'revisao-corrente');
      eventoDoUsuario(ajustada, 'proposta');
      assert.equal(statusDe(ajustada), 'proposto');

      const plano2 = novoPlano();
      const editada2 = versaoDoUsuario(plano2, { status: 'rascunho' });
      evento(editada2, 'parecer', 'revisao-antiga');
      const ajustada2 = novaVersaoDoAgente(plano2, 'revisao-nova', 'c2');
      assert.match(recusa(() => evento(ajustada2, 'ajuste', 'revisao-nova', { responde_a: editada2 })) ?? '', invalido);
    });

    it('propor: a versão com pareceres de duas execuções ou com ajuste de outra execução não passa pelo Comitê', () => {
      const plano = novoPlano();
      const v = versaoDoUsuario(plano, { status: 'rascunho' });
      evento(v, 'parecer', 'exec-p1', { persona: 'redator', veredito: 'aprova' });
      evento(v, 'parecer', 'exec-p2', { persona: 'buzz', veredito: 'aprova' });
      evento(v, 'gate', 'exec-p2');
      assert.match(recusa(() => eventoDoUsuario(v, 'proposta')) ?? '', /23514.*falta parecer do Comitê/s);

      const plano2 = novoPlano();
      const v1 = novaVersaoDoAgente(plano2, 'exec-q1', 'd1');
      evento(v1, 'parecer', 'exec-q1');
      const v2 = novaVersaoDoAgente(plano2, 'exec-q1', 'd2');
      evento(v2, 'ajuste', 'exec-q1', { responde_a: v1 });
      assert.equal(dono(`SELECT core.strategy_plan_passou_comite('${v2}'::uuid)`), 't');
      assert.equal(dono(`SELECT core.strategy_plan_passou_comite('${v2}'::uuid, 'exec-q1')`), 't');
      assert.equal(dono(`SELECT core.strategy_plan_passou_comite('${v2}'::uuid, 'exec-q2')`), 'f');
    });
  });
  it('a ficha é conferida no banco: worker com ficha antiga e lease ainda vigente do novo dono é recusado, em versão e em evento', () => {
    const plano = novoPlano();
    const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
    const run = `run-ficha-${sufixo}`;
    const id = sqlExecucaoDireta({ plano, run });
    comoWorker(ids.orgA, '*', '', `UPDATE core.strategy_plan_runs SET lease_until = now() - interval '1 minute' WHERE id = '${id}'`);
    comoWorker(ids.orgA, '*', '', `UPDATE core.strategy_plan_runs SET status = 'rodando', tentativas = tentativas + 1, lease_until = now() + interval '5 minutes' WHERE id = '${id}'`);
    assert.equal(dono(`SELECT status || '/' || tentativas || '/' || (lease_until > now())::text FROM core.strategy_plan_runs WHERE id = '${id}'`), 'rodando/2/true');
    const evento = (ficha) => doWorker(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'parecer', ator: 'agente', execucaoExata: run, ficha, chave: randomBytes(4).toString('hex') }));
    const versao = (ficha) => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', execucaoExata: run, ficha }));
    assert.match(recusa(() => evento(1)) ?? '', ESCRITA_SEM_EXECUCAO);
    assert.match(recusa(() => versao(1)) ?? '', ESCRITA_SEM_EXECUCAO);
    assert.match(recusa(() => evento(3)) ?? '', ESCRITA_SEM_EXECUCAO, 'ficha de reserva futura também não vale');
    assert.equal(eventosDe(rascunho, 'parecer'), '0');
    evento(2);
    assert.equal(eventosDe(rascunho, 'parecer'), '1');
    assert.equal(statusDe(versao(2)), 'rascunho');
  });

  it('para app e worker a ficha é obrigatória e inteira (ausente ou inválida é 42501); o superusuário não precisa dela', () => {
    const plano = novoPlano();
    const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
    const run = `run-guc-${sufixo}`;
    sqlExecucaoDireta({ plano, run });
    const semPreludio = (sql) => sql.replace(/^DO \$\$ BEGIN PERFORM set_config\([^;]*; END \$\$; /, '');
    const bruto = (extra = {}) => sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'parecer', ator: 'agente', execucaoExata: run, chave: randomBytes(4).toString('hex'), ...extra });
    assert.match(recusa(() => doWorker(semPreludio(bruto()))) ?? '', /42501.*ficha da reserva/s, 'worker sem o GUC');
    assert.match(recusa(() => comoWorker(ids.orgA, '*', '', semPreludio(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', execucaoExata: run })))) ?? '', /42501.*ficha da reserva/s);
    for (const invalida of ['abc', '-1', '1.5', '', ' ', '1; DROP', '123456']) {
      assert.match(recusa(() => doWorker(bruto({ ficha: invalida }))) ?? '', /42501.*(ficha válida|ficha da reserva)/s, `ficha ${JSON.stringify(invalida)}`);
    }
    assert.equal(eventosDe(rascunho, 'parecer'), '0');
    dono(semPreludio(bruto()));
    assert.equal(eventosDe(rascunho, 'parecer'), '1', 'o superusuário (migrações e manutenção) escreve sem a ficha');
  });

  it('proposta: o Gate aprovado de OUTRA execução não libera, nem com parecer próprio nem com ajuste', () => {
    const plano = novoPlano();
    const v = versaoDoUsuario(plano, { status: 'rascunho' });
    const primeira = `run-gate-a-${sufixo}`;
    const idPrimeira = sqlExecucaoDireta({ plano, run: primeira });
    doWorker(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: v, tipo: 'parecer', ator: 'agente', execucaoExata: primeira, chave: 'pa' }));
    comoWorker(ids.orgA, '*', '', `UPDATE core.strategy_plan_runs SET status = 'concluida', etapa = 'fim' WHERE id = '${idPrimeira}'`);
    const segunda = `run-gate-b-${sufixo}`;
    sqlExecucaoDireta({ plano, run: segunda });
    doWorker(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: v, tipo: 'gate', ator: 'agente', execucaoExata: segunda, chave: 'gb' }));
    assert.match(recusa(() => eventoDoUsuario(v, 'proposta')) ?? '', /23514.*não pode ser proposta: falta gate da mesma execução/s);
    assert.equal(statusDe(v), 'rascunho');

    const plano2 = novoPlano();
    const v1 = doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano: plano2, status: 'rascunho', autor: 'agente', execucao: 'cadeia-gate', chave: 'g1' }));
    eventoDoWorker(v1, 'parecer', { execucao: 'cadeia-gate' });
    const v2 = doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano: plano2, status: 'rascunho', autor: 'agente', execucao: 'cadeia-gate', chave: 'g2' }));
    eventoDoWorker(v2, 'ajuste', { execucao: 'cadeia-gate', payload: JSON.stringify({ responde_a: v1 }) });
    eventoDoWorker(v2, 'gate', { execucao: 'cadeia-gate' });
    eventoDoUsuario(v2, 'proposta');
    assert.equal(statusDe(v2), 'proposto', 'o gate da mesma execução do ajuste libera');
  });
});
