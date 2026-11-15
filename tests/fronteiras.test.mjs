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

const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
    encoding: 'utf8',
  }).trim();

const comoApp = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', '-e', `PGPASSWORD=${senhaDoApp()}`, 'orla-postgres',
     'psql', '-U', 'tria_app', '-h', '127.0.0.1', '-d', 'tria', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();

const naSessao = (org, clientIds, userId, sql) =>
  comoApp(
    `SET app.organization_id = '${org}'; SET app.client_ids = '${clientIds}'; ` +
      `SET app.user_id = '${userId}'; ${sql}`,
  );

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
        umaLinha(dono(`SELECT has_table_privilege('tria_app', '${tabela}', 'INSERT')`)),
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
          AND has_schema_privilege('tria_app', nspname, 'CREATE')`,
    );
    assert.equal(umaLinha(schemas), '0', 'criar objeto permitiria sombrear função usada em política');

    assert.equal(
      umaLinha(dono(`SELECT has_database_privilege('tria_app', 'tria', 'CREATE')`)),
      'f',
    );
    assert.equal(
      umaLinha(dono(`SELECT rolsuper::text || rolbypassrls::text FROM pg_roles WHERE rolname = 'tria_app'`)),
      'falsefalse',
    );
  });

  it('o papel do worker continua sem nenhum privilégio de objeto', () => {
    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM information_schema.table_privileges WHERE grantee = 'tria_worker'`)),
      '0',
    );
  });

  it('toda tabela de negócio tem RLS ligada e forçada', () => {
    const frouxas = dono(`
      SELECT coalesce(string_agg(n.nspname||'.'||c.relname, ', '), '')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname IN ('core','integrations','metrics','automation','audit')
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
    assert.equal(umaLinha(frouxas), '', `tabelas sem RLS forçada: ${frouxas}`);
  });

  it('toda tabela com RLS tem ao menos uma política', () => {
    const orfas = dono(`
      SELECT coalesce(string_agg(n.nspname||'.'||c.relname, ', '), '')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname IN ('core','integrations','metrics','automation','audit')
        AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)`);
    assert.equal(umaLinha(orfas), '');
  });

  it('nenhuma função SECURITY DEFINER fica sem search_path fixo', () => {
    const soltas = dono(`
      SELECT coalesce(string_agg(p.proname, ', '), '')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('core','integrations','metrics','automation','audit')
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
      WHERE n.nspname IN ('core','integrations','metrics','automation','audit')
        AND p.prosecdef
        AND has_function_privilege('public', p.oid, 'EXECUTE')`);
    assert.equal(umaLinha(abertas), '', `definer aberta ao público: ${abertas}`);
  });
});
