import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { appIsUp, ensureUser } from './helpers.mjs';

function senhaDoApp() {
  return readFileSync('.env', 'utf8')
    .split('\n')
    .find((linha) => linha.startsWith('APP_DB_PASSWORD='))
    .slice('APP_DB_PASSWORD='.length);
}

const CONTAINER = process.env.TRIA_TEST_PG ?? 'orla-postgres';

const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
    encoding: 'utf8',
  }).trim();

const comoApp = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', '-e', `PGPASSWORD=${senhaDoApp()}`, CONTAINER,
     'psql', '-U', 'orla_app', '-h', '127.0.0.1', '-d', 'tria', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();

function senhaDoWorker() {
  return readFileSync('.env', 'utf8')
    .split('\n')
    .find((linha) => linha.startsWith('WORKER_DB_PASSWORD='))
    .slice('WORKER_DB_PASSWORD='.length);
}

const comoWorker = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', '-e', `PGPASSWORD=${senhaDoWorker()}`, CONTAINER,
     'psql', '-U', 'orla_worker', '-h', '127.0.0.1', '-d', 'tria', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();

const naSessao = (org, clientIds, userId, sql) =>
  comoApp(
    `SET app.organization_id = '${org}'; SET app.client_ids = '${clientIds}'; ` +
      `SET app.user_id = '${userId}'; ${sql}`,
  );

const noContexto = (org, clientIds, userId, sql) =>
  `SET app.organization_id = '${org}'; SET app.client_ids = '${clientIds}'; SET app.user_id = '${userId}'; ${sql}`;

const naSessaoDoWorker = (org, clientIds, userId, sql) => comoWorker(noContexto(org, clientIds, userId, sql));

const umaLinha = (texto) => texto.split('\n')[0].trim();

const recusa = (fn) => {
  try {
    fn();
    return null;
  } catch (falha) {
    return String(falha.stderr ?? falha.message);
  }
};

describe('fronteiras entre inquilinos', { concurrency: false }, () => {
  let orgA = '';
  let orgB = '';
  let pessoaA = '';
  let pessoaB = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');

    dono(
      `TRUNCATE core.member_clients, core.invitations, metrics.metrics_restatements, metrics.metrics_daily,
               automation.account_tasks, automation.sync_runs, integrations.connection_accounts,
               integrations.ad_accounts, integrations.connections, core.clients, audit.audit_log,
               core.members, core.organizations RESTART IDENTITY CASCADE`,
    );

    orgA = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Casa A', 'casa-a', 'agency') RETURNING id`));
    orgB = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Casa B', 'casa-b', 'agency') RETURNING id`));

    pessoaA = ensureUser('pessoa.a@tria.local');
    pessoaB = ensureUser('pessoa.b@tria.local');
    dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${orgA}', '${pessoaA}', 'owner')
          ON CONFLICT (organization_id, user_id) DO UPDATE SET revoked_at = NULL`);
    dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${orgB}', '${pessoaB}', 'owner')
          ON CONFLICT (organization_id, user_id) DO UPDATE SET revoked_at = NULL`);
  });

  it('a sessão só enxerga a organização do contexto', () => {
    assert.equal(umaLinha(naSessao(orgA, '*', pessoaA, 'SELECT count(*) FROM core.organizations')), '1');
    assert.equal(
      umaLinha(naSessao(orgA, '*', pessoaA, `SELECT count(*) FROM core.organizations WHERE id = '${orgB}'`)),
      '0',
      'a organização do outro inquilino não podia aparecer',
    );
  });

  it('sem contexto, nenhuma organização é legível', () => {
    assert.equal(umaLinha(naSessao('', '', pessoaA, 'SELECT count(*) FROM core.organizations')), '0');
  });

  it('a tabela de identidade não é da plataforma inteira', () => {
    assert.equal(
      umaLinha(naSessao(orgA, '*', pessoaA, `SELECT count(*) FROM core.users WHERE id = '${pessoaB}'`)),
      '0',
      'o cadastro de quem é de outro inquilino não podia aparecer',
    );
    assert.equal(
      umaLinha(naSessao(orgA, '*', pessoaA, `SELECT count(*) FROM core.users WHERE id = '${pessoaA}'`)),
      '1',
    );
  });

  it('a sessão enxerga quem divide a organização com ela', () => {
    const colega = ensureUser('colega@tria.local');
    dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${orgA}', '${colega}', 'operator')
          ON CONFLICT (organization_id, user_id) DO UPDATE SET revoked_at = NULL`);

    assert.equal(
      umaLinha(naSessao(orgA, '*', pessoaA, `SELECT count(*) FROM core.users WHERE id = '${colega}'`)),
      '1',
    );
    assert.equal(
      umaLinha(naSessao(orgB, '*', pessoaB, `SELECT count(*) FROM core.users WHERE id = '${colega}'`)),
      '0',
    );
  });

  it('o app não escreve direto na identidade nem cria organização por INSERT', () => {
    for (const tabela of ['core.users', 'core.organizations']) {
      assert.equal(
        umaLinha(dono(`SELECT has_table_privilege('orla_app', '${tabela}', 'INSERT')`)),
        'f',
        `${tabela} não podia aceitar INSERT direto do app`,
      );
    }
  });

  it('ninguém reescreve a identidade alheia', () => {
    const erro = recusa(() =>
      naSessao(orgA, '*', pessoaA, `UPDATE core.users SET email = 'roubado@tria.local' WHERE id = '${pessoaB}'`),
    );
    assert.equal(
      umaLinha(dono(`SELECT email FROM core.users WHERE id = '${pessoaB}'`)),
      'pessoa.b@tria.local',
      erro ?? 'o e-mail do outro inquilino foi alterado',
    );
  });

  it('a trilha não aceita evento de outro inquilino', () => {
    const erro = recusa(() =>
      naSessao(
        orgA,
        '*',
        pessoaA,
        `INSERT INTO audit.audit_log (organization_id, actor_type, action)
         VALUES ('${orgB}', 'user', 'forjado')`,
      ),
    );
    assert.ok(erro, 'a política devia ter recusado o evento forjado');
    assert.ok(/row-level security|policy|política/i.test(erro), erro);

    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM audit.audit_log WHERE action = 'forjado'`)),
      '0',
    );
  });

  const forjar = (sessao, minhaOrg, orgAlheia, pessoa) =>
    recusa(() =>
      sessao(
        minhaOrg,
        '*',
        pessoa,
        `INSERT INTO audit.audit_log (organization_id, actor_type, action)
         VALUES ('${orgAlheia}', 'user', 'forjado')`,
      ),
    );

  it('a trilha recusa evento forjado nos dois sentidos e pelo papel do worker', () => {
    const recusas = {
      'app, B forjando A': forjar(naSessao, orgB, orgA, pessoaB),
      'worker, A forjando B': forjar(naSessaoDoWorker, orgA, orgB, pessoaA),
      'worker, B forjando A': forjar(naSessaoDoWorker, orgB, orgA, pessoaB),
    };
    for (const [cenario, erro] of Object.entries(recusas)) {
      assert.ok(erro, `${cenario}: a política devia ter recusado o evento forjado`);
      assert.ok(/row-level security|policy|política/i.test(erro), `${cenario}: ${erro}`);
    }
    assert.equal(umaLinha(dono(`SELECT count(*) FROM audit.audit_log WHERE action = 'forjado'`)), '0');

    naSessao(orgA, '*', pessoaA,
      `INSERT INTO audit.audit_log (organization_id, actor_type, action) VALUES ('${orgA}', 'user', 'proprio_app')`);
    naSessaoDoWorker(orgB, '*', pessoaB,
      `INSERT INTO audit.audit_log (organization_id, actor_type, action) VALUES ('${orgB}', 'user', 'proprio_worker')`);
    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM audit.audit_log WHERE action IN ('proprio_app', 'proprio_worker')`)),
      '2',
      'o evento da própria organização devia ser aceito (controle positivo)',
    );
  });

  const PAPEIS_DA_TRILHA = {
    app: ['orla_app', 'tria_app'],
    worker: ['orla_worker', 'tria_worker'],
  };

  const nomeDoPapel = (candidatos) =>
    umaLinha(dono(
      `SELECT rolname FROM pg_roles WHERE rolname IN (${candidatos.map((n) => `'${n}'`).join(',')}) ORDER BY rolname LIMIT 1`,
    ));

  it('app e worker não têm UPDATE, DELETE nem TRUNCATE direto na trilha', () => {
    for (const [rotulo, candidatos] of Object.entries(PAPEIS_DA_TRILHA)) {
      const papel = nomeDoPapel(candidatos);
      assert.ok(papel, `papel ${rotulo} não existe`);
      for (const privilegio of ['UPDATE', 'DELETE', 'TRUNCATE']) {
        assert.equal(
          umaLinha(dono(`SELECT has_table_privilege('${papel}', 'audit.audit_log', '${privilegio}')`)),
          'f',
          `${papel} não podia ter ${privilegio} em audit.audit_log`,
        );
      }
    }
  });

  it('UPDATE e DELETE reais na trilha falham por permissão nos dois papéis e a linha fica intacta', () => {
    dono(`INSERT INTO audit.audit_log (organization_id, actor_type, action) VALUES ('${orgA}', 'user', 'alvo_imutavel')`);
    const sessoes = { app: naSessao, worker: naSessaoDoWorker };

    for (const [rotulo, sessao] of Object.entries(sessoes)) {
      for (const comando of [
        `UPDATE audit.audit_log SET action = 'adulterado' WHERE action = 'alvo_imutavel'`,
        `DELETE FROM audit.audit_log WHERE action = 'alvo_imutavel'`,
        `TRUNCATE audit.audit_log`,
      ]) {
        const erro = recusa(() => sessao(orgA, '*', pessoaA, comando));
        assert.match(erro ?? '', /permission denied/, `${rotulo}: ${comando}`);
      }
    }
    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM audit.audit_log WHERE action = 'alvo_imutavel'`)),
      '1',
      'a linha da trilha foi alterada ou apagada',
    );
    assert.equal(umaLinha(dono(`SELECT count(*) FROM audit.audit_log WHERE action = 'adulterado'`)), '0');
  });

  it('a organização B não enxerga a trilha de A, nem pelo app nem pelo worker', () => {
    dono(`INSERT INTO audit.audit_log (organization_id, actor_type, action) VALUES ('${orgA}', 'user', 'so_da_org_a')`);
    dono(`INSERT INTO audit.audit_log (organization_id, actor_type, action) VALUES ('${orgB}', 'user', 'so_da_org_b')`);

    for (const sessao of [naSessao, naSessaoDoWorker]) {
      assert.equal(
        umaLinha(sessao(orgB, '*', pessoaB, `SELECT count(*) FROM audit.audit_log WHERE action = 'so_da_org_a'`)),
        '0',
        'a trilha de A apareceu para B',
      );
      assert.equal(
        umaLinha(sessao(orgB, '*', pessoaB,
          `SELECT count(*) FROM audit.audit_log WHERE organization_id <> '${orgB}'`)),
        '0',
        'B enxergou linha de outra organização',
      );
      assert.equal(
        umaLinha(sessao(orgB, '*', pessoaB, `SELECT count(*) FROM audit.audit_log WHERE action = 'so_da_org_b'`)),
        '1',
      );
      assert.equal(
        umaLinha(sessao(orgA, '*', pessoaA, `SELECT count(*) FROM audit.audit_log WHERE action = 'so_da_org_a'`)),
        '1',
      );
    }
    assert.equal(
      umaLinha(naSessao('', '', pessoaA, `SELECT count(*) FROM audit.audit_log`)),
      '0',
      'sem contexto a trilha não podia ser legível',
    );
  });

  const MUTA_A_TRILHA = String.raw`(update\s+(only\s+)?audit\.audit_log|delete\s+from\s+(only\s+)?audit\.audit_log|truncate\s+(table\s+)?(only\s+)?audit\.audit_log)`;

  it('função que altera a trilha não é executável pelo app (descoberta pelo catálogo)', () => {
    const mutadoras = dono(
      `SELECT string_agg(n.nspname||'.'||p.proname, ', ' ORDER BY n.nspname, p.proname)
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosrc ~* '${MUTA_A_TRILHA}'`,
    );
    assert.match(mutadoras, /core\.aplicar_retencao/, 'o catálogo devia achar ao menos a retenção');

    const papelApp = nomeDoPapel(PAPEIS_DA_TRILHA.app);
    const expostas = dono(
      `SELECT coalesce(string_agg(n.nspname||'.'||p.proname, ', '), '')
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosrc ~* '${MUTA_A_TRILHA}'
          AND has_function_privilege('${papelApp}', p.oid, 'EXECUTE')`,
    );
    assert.equal(umaLinha(expostas), '', `função que altera a trilha executável pelo app: ${expostas}`);
  });

  it('a faxina de passagens não alcança passagem viva', () => {
    dono(
      `INSERT INTO core.handoff_consumed (jti, expires_at)
       VALUES (gen_random_uuid(), now() + interval '1 hour'),
              (gen_random_uuid(), now() - interval '1 hour')`,
    );
    const vivasAntes = umaLinha(dono(`SELECT count(*) FROM core.handoff_consumed WHERE expires_at > now()`));

    naSessao('', '', pessoaA, 'DELETE FROM core.handoff_consumed WHERE true');

    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM core.handoff_consumed WHERE expires_at > now()`)),
      vivasAntes,
      'passagem viva foi apagada e poderia ser usada de novo',
    );
    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM core.handoff_consumed WHERE expires_at <= now()`)),
      '0',
      'a passagem vencida devia ter sido recolhida',
    );
  });

  it('o papel do app não cria objeto em lugar nenhum', () => {
    const schemas = dono(
      `SELECT count(*) FROM pg_namespace
        WHERE nspname IN ('public','core','integrations','metrics','automation','audit')
          AND has_schema_privilege('orla_app', nspname, 'CREATE')`,
    );
    assert.equal(umaLinha(schemas), '0', 'criar objeto permitiria sombrear função usada em política');

    assert.equal(
      umaLinha(dono(`SELECT has_database_privilege('orla_app', 'tria', 'CREATE')`)),
      'f',
    );
    assert.equal(
      umaLinha(dono(`SELECT rolsuper::text || rolbypassrls::text FROM pg_roles WHERE rolname = 'orla_app'`)),
      'falsefalse',
    );
  });

  it('o papel do worker não tem privilégio de tabela próprio: herda o do app, sob as mesmas políticas', () => {
    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM information_schema.table_privileges WHERE grantee = 'orla_worker'`)),
      '0',
    );
    assert.equal(umaLinha(dono(`SELECT pg_has_role('orla_worker', 'orla_app', 'USAGE')::text`)), 'true');
    assert.equal(umaLinha(dono(`SELECT pg_has_role('orla_app', 'orla_worker', 'USAGE')::text`)), 'false');
    assert.equal(
      umaLinha(dono(`SELECT rolsuper::text || rolbypassrls::text || rolcreaterole::text FROM pg_roles WHERE rolname = 'orla_worker'`)),
      'falsefalsefalse',
    );
  });

  it('a web não executa função SECURITY DEFINER que atravessa inquilinos; o worker executa', () => {
    const daWeb = dono(
      `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND (n.nspname = 'automation' OR (n.nspname = 'core' AND p.proname IN ('aplicar_retencao', 'contexto_brains_pendentes', 'contexto_clientes_para_reconstruir')))
          AND has_function_privilege('orla_app', p.oid, 'EXECUTE')`,
    );
    assert.equal(umaLinha(daWeb), '0', 'função de worker voltou a ser executável pela web (ADR 0028)');

    const doWorker = dono(
      `SELECT bool_and(has_function_privilege('orla_worker', p.oid, 'EXECUTE'))::text FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND p.prorettype <> 'trigger'::regtype
          AND (n.nspname = 'automation' OR (n.nspname = 'core' AND p.proname IN ('aplicar_retencao', 'contexto_brains_pendentes', 'contexto_clientes_para_reconstruir')))`,
    );
    assert.equal(umaLinha(doWorker), 'true');

    for (const chamada of [
      'SELECT count(*) FROM automation.dimensao_clientes()',
      'SELECT count(*) FROM automation.dimensao_fontes()',
      'SELECT count(*) FROM automation.dimensao_mudancas_de_posse()',
      'SELECT count(*) FROM automation.fontes_de_coleta(1)',
      'SELECT count(*) FROM automation.sync_queue(1, 1, interval \'1 hour\')',
      'SELECT core.aplicar_retencao()',
      "SELECT count(*) FROM core.contexto_brains_pendentes(1, interval '1 second')",
      'SELECT count(*) FROM core.contexto_clientes_para_reconstruir(NULL)',
    ]) {
      assert.match(recusa(() => comoApp(chamada)) ?? '', /permission denied/, chamada);
    }
    assert.match(comoWorker('SELECT count(*) FROM automation.dimensao_clientes()'), /^\d+$/);
  });

  it('toda tabela de negócio tem RLS ligada e forçada', () => {
    const frouxas = dono(`
      SELECT coalesce(string_agg(n.nspname||'.'||c.relname, ', '), '')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname IN ('core','integrations','metrics','automation','audit','privacidade')
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
    assert.equal(umaLinha(frouxas), '', `tabelas sem RLS forçada: ${frouxas}`);
  });

  const SEM_POLITICA_POR_DESENHO = "ARRAY['integrations.whatsapp_inbound_events','privacidade.expurgos_de_fonte']";

  it('tabelas sem política por desenho só são tocadas por funções SECURITY DEFINER', () => {
    const acessoDireto = dono(`
      SELECT coalesce(string_agg(t.tabela||':'||t.privilegio, ', '), '')
      FROM unnest(${SEM_POLITICA_POR_DESENHO}) AS x(tabela),
           LATERAL (SELECT x.tabela AS tabela, p AS privilegio
                    FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p
                    WHERE has_table_privilege((SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app','tria_app') LIMIT 1), x.tabela, p)) t`);
    assert.equal(umaLinha(acessoDireto), '');
  });

  it('toda tabela com RLS tem ao menos uma política', () => {
    const orfas = dono(`
      SELECT coalesce(string_agg(n.nspname||'.'||c.relname, ', '), '')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname IN ('core','integrations','metrics','automation','audit','privacidade')
        AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
        AND (n.nspname||'.'||c.relname) <> ALL (${SEM_POLITICA_POR_DESENHO})`);
    assert.equal(umaLinha(orfas), '');
  });

  it('nenhuma função SECURITY DEFINER fica sem search_path fixo', () => {
    const soltas = dono(`
      SELECT coalesce(string_agg(p.proname, ', '), '')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('core','integrations','metrics','automation','audit','privacidade')
        AND p.prosecdef
        AND NOT EXISTS (
          SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
          WHERE c LIKE 'search_path=%')`);
    assert.equal(umaLinha(soltas), '', `definer sem search_path: ${soltas}`);
  });

  it('nenhuma função SECURITY DEFINER fica executável por PUBLIC', () => {
    const abertas = dono(`
      SELECT coalesce(string_agg(p.proname, ', '), '')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('core','integrations','metrics','automation','audit','privacidade')
        AND p.prosecdef
        AND has_function_privilege('public', p.oid, 'EXECUTE')`);
    assert.equal(umaLinha(abertas), '', `definer aberta ao público: ${abertas}`);
  });
});
