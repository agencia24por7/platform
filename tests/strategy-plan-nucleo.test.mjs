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

const sqlVersao = ({ id = randomUUID(), org, cli, plano, status, autor = 'usuario', usuario, agente = 'comite', execucao = 'exec-1', chave, supersede, conteudo = '{"intencao":{"horizonte":"12m"}}' }) => {
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
    agent_run_id: agentico ? execucao : undefined,
    idempotency_key: agentico ? (chave ?? randomBytes(6).toString('hex')) : undefined,
  };
  const presentes = Object.entries(colunas).filter(([, valor]) => valor !== undefined);
  const nomes = presentes.map(([nome]) => nome).join(', ');
  const valores = presentes.map(([nome, valor]) => (nome === 'content' ? `${aspas(valor)}::jsonb` : nome === 'schema_version' ? valor : aspas(valor))).join(', ');
  return `INSERT INTO core.strategy_plan_versions (${nomes}) VALUES (${valores}) RETURNING id;`;
};

const sqlEvento = ({ org, cli, versao, tipo, ator = 'usuario', usuario, agente = 'comite', execucao = 'exec-1', chave, payload = '{}' }) => {
  const agentico = ator === 'agente';
  return `INSERT INTO core.strategy_plan_events (organization_id, client_id, version_id, kind, actor_kind, actor_user_id, agent_id, agent_run_id, idempotency_key, payload)
    VALUES (${aspas(org)}, ${aspas(cli)}, ${aspas(versao)}, ${aspas(tipo)}, ${aspas(ator)}, ${aspas(ator === 'usuario' ? usuario : null)}, ${aspas(agentico ? agente : null)},
            ${aspas(agentico ? execucao : null)}, ${aspas(agentico ? chave : null)}, ${aspas(payload)}::jsonb);`;
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
  const vigente = (plano, supersede) => {
    const id = versaoDoUsuario(plano, { status: 'proposto', supersede });
    eventoDoUsuario(id, 'efetivada');
    return id;
  };

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
    const versao = versaoDoUsuario(plano, { status: 'proposto' });
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
    assert.match(recusa(() => dono(`UPDATE core.strategy_plan_events SET kind = 'parecer' WHERE version_id = '${versao}'`)) ?? '', /23001.*só de acréscimo/s);
    assert.match(recusa(() => dono(`UPDATE core.strategy_plan_events SET payload = '{}'::jsonb WHERE version_id = '${versao}'`)) ?? '', /23001.*só de acréscimo/s);
    assert.match(recusa(() => dono(`DELETE FROM core.strategy_plan_events WHERE version_id = '${versao}'`)) ?? '', /23001.*não se apaga/s);
    assert.match(recusa(() => dono(`DELETE FROM core.strategy_plan_versions WHERE id = '${versao}'`)) ?? '', /23001.*não se apaga/s);
    assert.match(recusa(() => dono(`DELETE FROM core.strategy_plans WHERE id = '${plano}'`)) ?? '', /23001.*não se apaga/s);
  });

  it('o app só insere versão como rascunho ou proposto; proposto grava o evento proposta', () => {
    const plano = novoPlano();
    for (const status of ['vigente', 'superado', 'revogado', 'rejeitado']) {
      assert.match(recusa(() => versaoDoUsuario(plano, { status })) ?? '', /42501.*nasce rascunho ou proposto/s, status);
    }
    const proposto = versaoDoUsuario(plano, { status: 'proposto' });
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${proposto}' AND kind = 'proposta'`), '1');
  });

  it('duas versões vigentes do mesmo plano violam o índice; plano com vigente exige supersedes_id', () => {
    const plano = novoPlano();
    const primeira = versaoDoUsuario(plano, { status: 'proposto' });
    const segunda = versaoDoUsuario(plano, { status: 'proposto' });
    eventoDoUsuario(primeira, 'efetivada');
    assert.match(recusa(() => eventoDoUsuario(segunda, 'efetivada')) ?? '', /23505.*strategy_plan_versions_uma_vigente/s);
    assert.equal(statusDe(segunda), 'proposto');

    assert.match(recusa(() => versaoDoUsuario(plano, { status: 'rascunho' })) ?? '', /23514.*já tem versão vigente.*precisa superá-la/s);
    assert.match(recusa(() => versaoDoUsuario(plano, { status: 'proposto', supersede: segunda })) ?? '', /23514.*precisa superá-la/s);
    assert.match(recusa(() => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente' }))) ?? '', /23514.*precisa superá-la/s);
    assert.ok(versaoDoUsuario(plano, { status: 'rascunho', supersede: primeira }));
  });

  it('agente cria rascunho e proposto, nunca efetiva, rejeita ou revoga; usuário owner efetiva', () => {
    const plano = novoPlano();
    const rascunho = doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', chave: 'k1' }));
    assert.equal(statusDe(rascunho), 'rascunho');
    doAgente(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'proposta', ator: 'agente', chave: 'p1' }));
    assert.equal(statusDe(rascunho), 'proposto');

    for (const tipo of ['efetivada', 'rejeitada', 'revogada']) {
      assert.match(recusa(() => doAgente(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo, ator: 'agente' }))) ?? '', /42501.*falta política de autonomia/s, tipo);
      assert.match(recusa(() => dono(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo, ator: 'agente' }))) ?? '', /42501.*falta política de autonomia/s, `dono ${tipo}`);
      assert.match(recusa(() => comoWorker(ids.orgA, '*', '', sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo, ator: 'agente' }))) ?? '', /42501.*falta política de autonomia/s, `worker ${tipo}`);
    }
    assert.match(recusa(() => doAgente(sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'vigente', autor: 'agente' }))) ?? '', /42501.*nasce rascunho ou proposto/s);
    assert.match(recusa(() => doApp(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: rascunho, tipo: 'efetivada', ator: 'agente' }))) ?? '', /42501.*falta política de autonomia/s);
    assert.equal(statusDe(rascunho), 'proposto');

    const doWorker = comoWorker(ids.orgA, '*', '', sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente', agente: 'worker-agente', execucao: 'exec-w' }));
    assert.equal(statusDe(doWorker), 'rascunho');

    eventoDoUsuario(rascunho, 'efetivada');
    assert.equal(statusDe(rascunho), 'vigente');
    eventoDoUsuario(rascunho, 'revogada');
    assert.equal(statusDe(rascunho), 'revogado');
  });

  it('efetivar, rejeitar e revogar exigem owner ou admin vivo; viewer, operator, revogado e não membro são negados', () => {
    const plano = novoPlano();
    const proposto = (extra = {}) => versaoDoUsuario(plano, { status: 'proposto', ...extra });
    const alvo = proposto();
    for (const tipo of ['efetivada', 'rejeitada', 'revogada']) {
      assert.match(recusa(() => eventoDoUsuario(alvo, tipo, ids.operador)) ?? '', /42501.*exige papel owner ou admin/s, `operator ${tipo}`);
      assert.match(recusa(() => eventoDoUsuario(alvo, tipo, ids.leitor)) ?? '', /42501.*registrar evento exige papel owner, admin ou operator/s, `viewer ${tipo}`);
    }
    eventoDoUsuario(alvo, 'parecer', ids.operador);
    assert.match(recusa(() => eventoDoUsuario(alvo, 'efetivada', ids.revogado)) ?? '', /42501.*não é membro vivo/s);
    assert.match(recusa(() => eventoDoUsuario(alvo, 'efetivada', ids.naoMembro)) ?? '', /42501.*não é membro vivo/s);
    assert.match(recusa(() => versaoDoUsuario(plano, { status: 'rascunho' }, ids.revogado)) ?? '', /42501.*não é membro vivo/s);
    assert.match(recusa(() => eventoDoUsuario(alvo, 'efetivada', ids.dono, { usuario: ids.admin })) ?? '', /42501.*usuário da sessão/s);
    assert.equal(statusDe(alvo), 'proposto');

    eventoDoUsuario(alvo, 'rejeitada', ids.admin);
    assert.equal(statusDe(alvo), 'rejeitado');
    const outro = proposto();
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
    assert.match(recusa(() => dono(`${base}, agent_id, agent_run_id) VALUES (${comum}, 'x', 'r')`)) ?? '', /23514.*strategy_plan_versions_autor/s);
    assert.match(recusa(() => dono(`INSERT INTO core.strategy_plan_versions (organization_id, client_id, plan_id, content, schema_version, author_kind, author_user_id, idempotency_key) VALUES ('${ids.orgA}', '${ids.cliA}', '${plano}', '{}'::jsonb, 1, 'usuario', '${ids.dono}', 'k')`)) ?? '', /23514.*strategy_plan_versions_autor/s);
    assert.match(recusa(() => dono(`INSERT INTO core.strategy_plan_events (organization_id, client_id, version_id, kind, actor_kind, actor_user_id, agent_id) VALUES ('${ids.orgA}', '${ids.cliA}', '${versaoDoUsuario(plano, { status: 'rascunho' })}', 'parecer', 'usuario', '${ids.dono}', 'x')`)) ?? '', /23514.*strategy_plan_events_agente/s);
  });

  it('superar marca a anterior superado na mesma transação', () => {
    const plano = novoPlano();
    const anterior = vigente(plano);
    const nova = versaoDoUsuario(plano, { status: 'proposto', supersede: anterior });
    assert.equal(statusDe(anterior), 'vigente');

    const dentro = doApp(
      sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: nova, tipo: 'efetivada', usuario: ids.dono }) +
        `SELECT string_agg(id::text || '=' || status, ',' ORDER BY status) FROM core.strategy_plan_versions WHERE id IN ('${anterior}', '${nova}');`,
    );
    assert.equal(dentro, `${anterior}=superado,${nova}=vigente`);

    const outroPlano = novoPlano();
    assert.match(recusa(() => versaoDoUsuario(outroPlano, { status: 'proposto', supersede: nova })) ?? '', /23000.*não existe neste plano/s);
    assert.match(recusa(() => versaoDoUsuario(plano, { status: 'proposto', supersede: anterior })) ?? '', /23514.*precisa superá-la/s);
  });

  it('concorrência real: duas efetivações da mesma vigente, uma vence e a outra falha', async () => {
    const plano = novoPlano();
    const base = vigente(plano);
    const segunda = versaoDoUsuario(plano, { status: 'proposto', supersede: base });
    const terceira = versaoDoUsuario(plano, { status: 'proposto', supersede: base });
    const efetivar = (versao) =>
      executar('docker', argumentos('orla_app', variavel('APP_DB_PASSWORD'), contexto(ids.orgA, '*', ids.dono) + sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'efetivada', usuario: ids.dono }) + 'SELECT pg_sleep(1.5);'), { encoding: 'utf8' });
    const primeira = efetivar(segunda);
    await new Promise((resolver) => setTimeout(resolver, 500));
    const concorrente = efetivar(terceira);
    const resultados = await Promise.allSettled([primeira, concorrente]);
    assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
    const falha = resultados.find((r) => r.status === 'rejected');
    assert.match(String(falha.reason.stderr), /23514.*não está mais vigente/s);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE plan_id = '${plano}' AND status = 'vigente'`), '1');
    assert.equal(statusDe(base), 'superado');
    assert.equal([statusDe(segunda), statusDe(terceira)].sort().join(','), 'proposto,vigente');
  });

  it('transições inválidas são recusadas; parecer não muda status', () => {
    const plano = novoPlano();
    const rascunho = versaoDoUsuario(plano, { status: 'rascunho' });
    for (const tipo of ['efetivada', 'rejeitada', 'revogada']) {
      assert.match(recusa(() => eventoDoUsuario(rascunho, tipo)) ?? '', /23514.*transição inválida/s, tipo);
    }
    eventoDoUsuario(rascunho, 'proposta');
    assert.equal(statusDe(rascunho), 'proposto');
    assert.match(recusa(() => eventoDoUsuario(rascunho, 'proposta')) ?? '', /23514.*(não pode ser proposta|já foi proposta)/s);
    eventoDoUsuario(rascunho, 'rejeitada');
    assert.equal(statusDe(rascunho), 'rejeitado');
    assert.match(recusa(() => eventoDoUsuario(rascunho, 'efetivada')) ?? '', /23514.*transição inválida/s);
    eventoDoUsuario(rascunho, 'parecer', ids.dono, { payload: '{"resumo":"ok"}' });
    assert.equal(statusDe(rascunho), 'rejeitado');
    assert.match(recusa(() => eventoDoUsuario(rascunho, 'redigida')) ?? '', /42501.*só nasce de core.redigir_plano/s);
  });

  it('isolamento: outra organização e cliente fora do escopo não leem nem inserem, sem vazar nem travar', () => {
    const plano = novoPlano();
    const versao = versaoDoUsuario(plano, { status: 'proposto' });
    const tabelas = ['strategy_plans', 'strategy_plan_versions', 'strategy_plan_refs', 'strategy_plan_events'];
    const comRef = randomUUID();
    const planoRef = novoPlano();
    doApp(
      sqlVersao({ id: comRef, org: ids.orgA, cli: ids.cliA, plano: planoRef, usuario: ids.dono, status: 'rascunho' }) +
        sqlRef({ org: ids.orgA, cli: ids.cliA, versao: comRef, urn: `orla:${ids.orgA}:${ids.cliA}:regra:r-iso` }) +
        sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: comRef, tipo: 'parecer', usuario: ids.dono }),
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
    assert.match(recusa(() => comoApp(ids.orgA, ids.cliA2, ids.dono, sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'parecer', usuario: ids.dono }))) ?? '', fora);
    assert.match(recusa(() => comoApp(ids.orgA, ids.cliA2, ids.dono, sqlRef({ org: ids.orgA, cli: ids.cliA, versao: comRef, urn: `orla:${ids.orgA}:${ids.cliA}:regra:r-x` }))) ?? '', fora);
    assert.match(
      recusa(() => comoApp(ids.orgB, '*', ids.donoB, sqlVersao({ org: ids.orgB, cli: ids.cliB, plano, usuario: ids.donoB, status: 'proposto', supersede: versao }))) ?? '',
      /23000.*plano inexistente neste cliente/s,
    );
    assert.match(recusa(() => comoApp(ids.orgB, '*', ids.donoB, sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'efetivada', usuario: ids.donoB }))) ?? '', fora);
    assert.match(recusa(() => comoApp(ids.orgB, '*', ids.donoB, sqlEvento({ org: ids.orgB, cli: ids.cliB, versao, tipo: 'parecer', usuario: ids.donoB }))) ?? '', /23503/);
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
    assert.match(recusa(() => dono(sqlRef({ org: ids.orgA, cli: ids.cliA, versao, urn }))) ?? '', /23505.*strategy_plan_refs_unica|23001/s);
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

  it('teto de escrita do agente por execução e por cliente em 24 h, com o papel do worker (ORT01 e ORT02)', () => {
    const cli = cliente(ids.orgA, 'cli-teto');
    const plano = novoPlano(cli);
    const versao = (execucao, quem = 'worker', extra = '') =>
      comoWorker(ids.orgA, '*', '', `${extra}${sqlVersao({ org: ids.orgA, cli, plano, status: 'rascunho', autor: 'agente', execucao })}`);

    const reduz = 'SET orla.teto_agente_por_execucao = 2; ';
    versao('run-a', 'worker', reduz);
    versao('run-a', 'worker', reduz);
    const porExecucao = recusa(() => versao('run-a', 'worker', reduz));
    assert.match(porExecucao ?? '', /ORT01.*teto de versões do agente por execução/s);
    versao('run-b', 'worker', reduz);

    assert.match(recusa(() => versao('run-c', 'worker', 'SET orla.teto_agente_por_dia = 3; ')) ?? '', /ORT02.*teto diário de versões/s);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE client_id = '${cli}'`), '3');

    const cli3 = cliente(ids.orgA, 'cli-teto-teto');
    const plano3 = novoPlano(cli3);
    assert.match(
      recusa(() => comoWorker(ids.orgA, '*', '', `SET orla.teto_agente_por_execucao = 9999; SET orla.teto_agente_por_dia = 99999;
        DO $$ BEGIN FOR i IN 1..51 LOOP
          INSERT INTO core.strategy_plan_versions (organization_id, client_id, plan_id, content, schema_version, author_kind, agent_id, agent_run_id, idempotency_key)
          VALUES ('${ids.orgA}', '${cli3}', '${plano3}', '{}'::jsonb, 1, 'agente', 'comite', 'run-massa', 'k' || i);
        END LOOP; END $$;`)) ?? '',
      /ORT01.*teto de versões do agente por execução atingido \(50\)/s,
      'o GUC só reduz o teto, nunca o amplia',
    );
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_versions WHERE client_id = '${cli3}'`), '0');

    const cli2 = cliente(ids.orgA, 'cli-teto-ev');
    const plano2 = novoPlano(cli2);
    const rascunho = comoWorker(ids.orgA, '*', '', sqlVersao({ org: ids.orgA, cli: cli2, plano: plano2, status: 'rascunho', autor: 'agente', execucao: 'run-v' }));
    const parecer = (execucao, extra = '') =>
      comoWorker(ids.orgA, '*', '', `${extra}${sqlEvento({ org: ids.orgA, cli: cli2, versao: rascunho, tipo: 'parecer', ator: 'agente', execucao, chave: randomBytes(5).toString('hex') })}`);
    parecer('run-e', reduz);
    parecer('run-e', reduz);
    assert.match(recusa(() => parecer('run-e', reduz)) ?? '', /ORT01.*teto de eventos do agente por execução/s);
    assert.match(recusa(() => parecer('run-f', 'SET orla.teto_agente_por_dia = 2; ')) ?? '', /ORT02.*teto diário de eventos/s);
  });

  it('redação LGPD: só o worker executa, segue a cadeia nos dois sentidos e cobre content e payload', () => {
    const plano = novoPlano();
    const primeira = vigente(plano);
    const segunda = vigente(plano, primeira);
    const terceira = vigente(plano, segunda);
    const alheio = novoPlano();
    const alheiaVersao = versaoDoUsuario(alheio, { status: 'rascunho', conteudo: '{"segredo":"mantido"}' });
    eventoDoUsuario(segunda, 'parecer', ids.dono, { payload: '{"resumo":"texto livre"}' });

    assert.match(recusa(() => doApp(`SELECT core.redigir_plano('${segunda}', 'pedido do titular')`)) ?? '', /42501.*permission denied for function redigir_plano/s);
    assert.match(recusa(() => comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${segunda}', 'x')`)) ?? '', /23514.*motivo da redação obrigatório/s);
    assert.match(recusa(() => comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${randomUUID()}', 'pedido do titular')`)) ?? '', /P0002|no_data_found|versão inexistente/s);

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
    assert.match(recusa(() => comoWorker(ids.orgA, '*', '', `UPDATE core.strategy_plan_versions SET content = '{"redigido": true}'::jsonb WHERE id = '${alheiaVersao}'`)) ?? '', /42501/);
  });

  it('exclusão de usuário zera author_user_id e actor_user_id antes de o cliente sumir', () => {
    const autor = usuario('autor-apagado');
    membro(ids.orgA, autor, 'owner');
    const plano = novoPlano();
    const versao = versaoDoUsuario(plano, { status: 'proposto', usuario: autor }, autor);
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
    dono(
      `INSERT INTO core.strategy_plans (id, organization_id, client_id, plan_type_key) VALUES ('${plano}', '${ids.orgA}', '${cli}', 'marca');` +
        sqlVersao({ id: v1, org: ids.orgA, cli, plano, usuario: ids.dono, status: 'proposto' }) +
        sqlRef({ org: ids.orgA, cli, versao: v1, urn, papel: 'evidencia_contra' }) +
        sqlEvento({ org: ids.orgA, cli, versao: v1, tipo: 'efetivada', usuario: ids.dono }),
    );
    dono(
      sqlVersao({ id: v2, org: ids.orgA, cli, plano, usuario: ids.dono, status: 'proposto', supersede: v1 }) +
        sqlRef({ org: ids.orgA, cli, versao: v2, urn: `orla:${ids.orgA}:${cli}:regra:r-2` }) +
        sqlEvento({ org: ids.orgA, cli, versao: v2, tipo: 'efetivada', usuario: ids.dono }),
    );
    const contar = () =>
      dono(`SELECT (SELECT count(*) FROM core.strategy_plans WHERE client_id = '${cli}') || '/' || (SELECT count(*) FROM core.strategy_plan_versions WHERE client_id = '${cli}')
            || '/' || (SELECT count(*) FROM core.strategy_plan_refs WHERE client_id = '${cli}') || '/' || (SELECT count(*) FROM core.strategy_plan_events WHERE client_id = '${cli}')`);
    assert.equal(contar(), '1/2/2/4');
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
    assert.match(recusa(() => eventoDoUsuario(versao, 'parecer', ids.leitor)) ?? '', /42501.*registrar evento exige papel owner, admin ou operator/s);
    assert.equal(statusDe(versao), 'rascunho');

    doApp(`INSERT INTO core.strategy_plans (id, organization_id, client_id, plan_type_key) VALUES ('${planoId}', '${ids.orgA}', '${ids.cliA}', 'operador')`, ids.operador);
    const doOperador = versaoDoUsuario(planoId, { status: 'rascunho', usuario: ids.operador }, ids.operador);
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
      recusa(() => comoApp(ids.orgB, ids.cliB, ids.donoB, sqlVersao({ org: ids.orgB, cli: ids.cliB, plano: planoA, usuario: ids.donoB, status: 'proposto', supersede: vigenteA }))),
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
        `ALTER TABLE core.strategy_plan_events DISABLE TRIGGER strategy_plan_events_antes;` +
          sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'parecer', usuario: ids.dono, payload: JSON.stringify({ resumo: texto }) }) +
          `ALTER TABLE core.strategy_plan_events ENABLE TRIGGER strategy_plan_events_antes;`,
      );
    tardio(segunda, 'texto livre posterior');
    tardio(primeira, 'outro texto');
    assert.equal(dono(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'strategy_plan_events_antes'`), 'O');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id IN ('${primeira}', '${segunda}') AND kind = 'parecer' AND payload <> '{"redigido": true}'::jsonb`), '2');

    comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${primeira}', 'de novo')`);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id IN ('${primeira}', '${segunda}') AND kind <> 'redigida' AND payload <> '{"redigido": true}'::jsonb`), '0');
    assert.equal(redigidas(), '2');
    comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${primeira}', 'outra vez')`);
    assert.equal(redigidas(), '2');
  });

  it('app e worker não alcançam a exceção de redação por GUC', () => {
    const plano = novoPlano();
    const versao = versaoDoUsuario(plano, { status: 'rascunho' });
    eventoDoUsuario(versao, 'parecer', ids.dono, { payload: '{"resumo":"x"}' });
    const marca = `SET orla.redigindo_plano = '${versao}'; `;
    const versoes = `UPDATE core.strategy_plan_versions SET content = '{"redigido": true}'::jsonb, redacted_at = now() WHERE id = '${versao}'`;
    const eventos = `UPDATE core.strategy_plan_events SET payload = '{"redigido": true}'::jsonb WHERE version_id = '${versao}'`;
    for (const executa of [(sql) => doApp(marca + sql), (sql) => comoWorker(ids.orgA, '*', ids.dono, marca + sql)]) {
      assert.match(recusa(() => executa(versoes)) ?? '', /42501.*permission denied/s);
      assert.match(recusa(() => executa(eventos)) ?? '', /42501.*permission denied/s);
    }
    assert.equal(dono(`SELECT content::text FROM core.strategy_plan_versions WHERE id = '${versao}'`), '{"intencao": {"horizonte": "12m"}}');
  });

  it('proposta de agente perto do teto de eventos: o evento proposta conta, com mensagem explícita', () => {
    const cli = cliente(ids.orgA, 'cli-teto-proposta');
    const plano = novoPlano(cli);
    const reduz = 'SET orla.teto_agente_por_execucao = 2; ';
    const versao = (extra = {}) => comoWorker(ids.orgA, '*', '', reduz + sqlVersao({ org: ids.orgA, cli, plano, autor: 'agente', execucao: 'run-p', ...extra }));
    const proposto = versao({ status: 'proposto' });
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${proposto}' AND kind = 'proposta' AND actor_kind = 'agente'`), '1');
    const rascunho = versao({ status: 'rascunho' });
    const parecer = () => comoWorker(ids.orgA, '*', '', reduz + sqlEvento({ org: ids.orgA, cli, versao: rascunho, tipo: 'parecer', ator: 'agente', execucao: 'run-p', chave: randomBytes(5).toString('hex') }));
    parecer();
    assert.match(recusa(() => parecer()) ?? '', /ORT01.*o evento proposta de versão proposta também conta/s);
  });

  it('ordem única de travas: parecer de agente na versão que o usuário efetiva, antes de ele criar a sucessora, sem deadlock', async () => {
    const plano = novoPlano();
    const base = vigente(plano);
    const candidata = versaoDoUsuario(plano, { status: 'proposto', supersede: base });
    const agenteNaCandidata = (indice) =>
      executar('docker', argumentos('orla_worker', variavel('WORKER_DB_PASSWORD'), contexto(ids.orgA, '*', '') + sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: candidata, tipo: 'parecer', ator: 'agente', execucao: 'run-par', chave: `par-${indice}-${randomBytes(3).toString('hex')}` })), { encoding: 'utf8' });
    const transacaoDoUsuario = executar(
      'docker',
      argumentos(
        'orla_app',
        variavel('APP_DB_PASSWORD'),
        contexto(ids.orgA, '*', ids.dono) +
          sqlEvento({ org: ids.orgA, cli: ids.cliA, versao: candidata, tipo: 'efetivada', usuario: ids.dono }) +
          'SELECT pg_sleep(1.5);' +
          sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, usuario: ids.dono, status: 'rascunho', supersede: candidata }),
      ),
      { encoding: 'utf8' },
    );
    await new Promise((resolver) => setTimeout(resolver, 500));
    const resultados = await Promise.allSettled([transacaoDoUsuario, agenteNaCandidata(0), agenteNaCandidata(1)]);
    for (const resultado of resultados) {
      assert.equal(resultado.status, 'fulfilled', String(resultado.reason?.stderr));
      assert.doesNotMatch(String(resultado.value?.stderr ?? ''), /40P01/);
    }
    assert.equal(statusDe(candidata), 'vigente');
    assert.equal(statusDe(base), 'superado');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${candidata}' AND kind = 'parecer' AND actor_kind = 'agente'`), '2');
  });

  it('o pool da web sem usuário (orla_app, app.user_id vazio) não escreve nem como agente nem pulando o papel', () => {
    const semUsuario = /42501.*(sessão sem usuário só vale para o worker|autor agente só pelo worker|ator agente só pelo worker)/s;
    const plano = novoPlano();
    const versao = versaoDoUsuario(plano, { status: 'rascunho' });
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', `INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key) VALUES ('${ids.orgA}', '${ids.cliA}', 'sem_usuario')`)) ?? '', semUsuario);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', autor: 'agente' }))) ?? '', semUsuario);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'parecer', ator: 'agente' }))) ?? '', semUsuario);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'proposta', ator: 'agente' }))) ?? '', semUsuario);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlVersao({ org: ids.orgA, cli: ids.cliA, plano, status: 'rascunho', usuario: ids.dono }))) ?? '', /42501.*usuário da sessão/s);
    assert.match(recusa(() => comoApp(ids.orgA, '*', '', sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'parecer', usuario: ids.dono }))) ?? '', /42501.*usuário da sessão/s);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${versao}'`), '0');
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plans WHERE plan_type_key = 'sem_usuario'`), '0');
  });

  it('versão redigida só aceita evento com payload vazio', () => {
    const plano = novoPlano();
    const versao = versaoDoUsuario(plano, { status: 'rascunho' });
    comoWorker(ids.orgA, '*', '', `SELECT core.redigir_plano('${versao}', 'pedido do titular')`);
    assert.match(recusa(() => eventoDoUsuario(versao, 'parecer', ids.dono, { payload: '{"resumo":"texto livre"}' })) ?? '', /23514.*versão redigida só aceita evento com payload vazio/s);
    assert.match(recusa(() => doAgente(sqlEvento({ org: ids.orgA, cli: ids.cliA, versao, tipo: 'parecer', ator: 'agente', payload: '{"resumo":"texto"}' }))) ?? '', /23514.*payload vazio/s);
    eventoDoUsuario(versao, 'parecer', ids.dono);
    assert.equal(dono(`SELECT count(*) FROM core.strategy_plan_events WHERE version_id = '${versao}' AND kind = 'parecer' AND payload = '{}'::jsonb`), '1');
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
});
