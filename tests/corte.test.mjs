import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PG_CONTAINER } from './apoio/pgContainer.mjs';

const BANCO = `corte_teste_${process.pid}`;
const pasta = mkdtempSync(join(tmpdir(), 'corte-'));

const psql = (sql, banco = BANCO) =>
  execFileSync('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-X', '-U', 'postgres', '-d', banco, '-v', 'ON_ERROR_STOP=1', '-qtA'], {
    input: sql,
    encoding: 'utf8',
  }).trim();

const falhaDe = (acao) => {
  try {
    acao();
    return '';
  } catch (erro) {
    return String(erro.stderr ?? erro.message);
  }
};

function tentarMigrar(extra = {}) {
  const r = spawnSync('sh', ['infra/compose/migrar.sh'], {
    encoding: 'utf8',
    env: { ...process.env, PG_CONTAINER: PG_CONTAINER, PG_USER: 'postgres', PG_DB: BANCO, MIGRACOES_DIR: pasta, SINCRONIZAR_SENHA_WORKER: '0', ...extra },
  });
  return { status: r.status, saida: `${r.stdout}${r.stderr}` };
}

function migrar() {
  const r = tentarMigrar();
  assert.equal(r.status, 0, r.saida);
}

const RELEASE = 'release-0123-teste';
const marcaDoPreflight = join(pasta, '.preflight-ok');
const autorizado = () => {
  writeFileSync(marcaDoPreflight, `${RELEASE}\n`);
  return { CORTE_GATE_ARQUIVO: 'db/corte-gate.txt', PREFLIGHT_MARCA: marcaDoPreflight, RELEASE_ID: RELEASE, RELEASE_CORTE_AUTORIZADO: '1' };
};
const tabelaDoCorteExiste = () => psql(`SELECT to_regclass('integrations.corte_para_cofre_refs') IS NOT NULL`) === 't';
const foiAplicada = (nome) => psql(`SELECT count(*) FROM public.schema_migrations WHERE nome = '${nome}'`) === '1';

const criados = [];
const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const GOOGLE = '33333333-3333-4333-8333-333333333331';
const GA4 = '33333333-3333-4333-8333-333333333332';
const META_REVOGADA = '33333333-3333-4333-8333-333333333333';
const RD = '33333333-3333-4333-8333-333333333334';

const LEGADO = `
INSERT INTO core.organizations (id, name, slug, type) VALUES ('${ORG}', 'Legado', 'legado', 'agency');
INSERT INTO core.clients (id, organization_id, name, business_model) VALUES ('${CLIENTE}', '${ORG}', 'Credaz', 'leads');
INSERT INTO integrations.connections (id, organization_id, platform, grant_type, label, external_id, scopes, credential_ref, coletor_ref, executor_ref, status)
VALUES
 ('${GOOGLE}', '${ORG}', 'google', 'oauth_user', 'Google', 'g-1', ARRAY['https://www.googleapis.com/auth/adwords'], 'n8n:credential:credG1', 'wfColG1', 'wfExeG1', 'active'),
 ('${GA4}', '${ORG}', 'ga4', 'oauth_user', 'GA4', 'ga-1', ARRAY[]::text[], 'n8n:credential:credGa', 'wfColGa', NULL, 'expiring'),
 ('${META_REVOGADA}', '${ORG}', 'meta', 'oauth_user', 'Meta', 'm-1', ARRAY['ads_read'], 'descartada', NULL, NULL, 'revoked'),
 ('${RD}', '${ORG}', 'rdstation', 'api_key', 'RD', 'principal', ARRAY[]::text[], 'pendente:cofre-indisponivel', NULL, NULL, 'degraded');
INSERT INTO integrations.ad_accounts (id, organization_id, client_id, connection_id, platform, external_id, name)
VALUES ('44444444-4444-4444-8444-444444444444', '${ORG}', '${CLIENTE}', '${GOOGLE}', 'google', '123-456-7890', 'Conta');
INSERT INTO integrations.connection_accounts (organization_id, connection_id, platform, external_id, name, state, client_id)
VALUES ('${ORG}', '${GA4}', 'ga4', 'properties/1', 'Site', 'linked', '${CLIENTE}');
INSERT INTO automation.account_tasks (organization_id, connection_id, kind, manager_external_id, target_external_id, status)
VALUES ('${ORG}', '${GOOGLE}', 'mcc_invite', '8124459032', '1234567890', 'pending');
`;

describe('corte para o cofre sobre dados legados no Postgres real (0121/0122, ADR 0032)', { concurrency: false }, () => {
  before(() => {
    for (const papel of ['tria_app', 'tria_worker']) {
      if (psql(`SELECT count(*) FROM pg_roles WHERE rolname = '${papel}'`, 'postgres') === '0') {
        psql(`CREATE ROLE ${papel} NOLOGIN`, 'postgres');
        criados.push(papel);
      }
    }
    psql(`CREATE DATABASE ${BANCO}`, 'postgres');
    for (const arquivo of readdirSync('db/migrations').filter((nome) => nome.endsWith('.sql') && nome < '0121')) {
      copyFileSync(join('db/migrations', arquivo), join(pasta, arquivo));
    }
    migrar();
    psql(LEGADO);
    copyFileSync('db/migrations/0121_corte_para_cofre.sql', join(pasta, '0121_corte_para_cofre.sql'));
    copyFileSync('db/migrations/0122_cofre_modo_unico.sql', join(pasta, '0122_cofre_modo_unico.sql'));
    migrar();
  });

  after(() => {
    psql(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`, 'postgres');
    for (const papel of criados) falhaDe(() => psql(`DROP ROLE IF EXISTS ${papel}`, 'postgres'));
    rmSync(pasta, { recursive: true, force: true });
  });

  it('captura os ponteiros do n8n antes de zerá-los, com o status anterior', () => {
    assert.equal(
      psql(`SELECT string_agg(platform || ':' || status_anterior || ':' || coalesce(credential_ref, '-') || ':' || coalesce(coletor_ref, '-') || ':' || coalesce(executor_ref, '-'), '|' ORDER BY platform)
            FROM integrations.corte_para_cofre_refs`),
      'ga4:expiring:n8n:credential:credGa:wfColGa:-|google:active:n8n:credential:credG1:wfColG1:wfExeG1|meta:revoked:descartada:-:-|rdstation:degraded:pendente:cofre-indisponivel:-:-',
    );
    assert.equal(psql('SELECT count(*) FROM integrations.corte_para_cofre_refs WHERE limpo_em IS NOT NULL'), '0');
    assert.equal(psql(`SELECT count(*) FROM integrations.connections WHERE credential_ref IS NOT NULL OR coletor_ref IS NOT NULL OR executor_ref IS NOT NULL`), '0');
  });

  it('marca reauth_pending (revogada fica revogada), audita e falha as tarefas pendentes', () => {
    assert.equal(psql(`SELECT string_agg(platform::text || ':' || status::text, ',' ORDER BY platform::text) FROM integrations.connections`),
      'ga4:reauth_pending,google:reauth_pending,meta:revoked,rdstation:reauth_pending');
    assert.equal(psql(`SELECT count(*) FROM audit.audit_log WHERE action = 'connection.corte_para_cofre'`), '4');
    assert.equal(psql(`SELECT status::text FROM automation.account_tasks`), 'failed');
  });

  it('preserva ids, contas e vínculos com clientes', () => {
    assert.equal(psql(`SELECT count(*) FROM integrations.ad_accounts WHERE connection_id = '${GOOGLE}' AND status = 'linked'`), '1');
    assert.equal(psql(`SELECT client_id FROM integrations.connection_accounts WHERE connection_id = '${GA4}'`), CLIENTE);
  });

  it('a trava adiada recusa voltar a active sem token, e aceita com o token na mesma transação', () => {
    assert.match(falhaDe(() => psql(`UPDATE integrations.connections SET status = 'active' WHERE id = '${GA4}'`)), /ativa sem token no cofre/);
    psql(`BEGIN;
      UPDATE integrations.connections SET status = 'active' WHERE id = '${GA4}';
      INSERT INTO integrations.connection_tokens (connection_id, organization_id, tipo, ciphertext, kms_key_version, algoritmo)
      VALUES ('${GA4}', '${ORG}', 'oauth_refresh', decode(repeat('ab', 40), 'hex'), 'local:v1', 'aes-256-gcm+local');
      COMMIT;`);
    assert.equal(psql(`SELECT status::text FROM integrations.connections WHERE id = '${GA4}'`), 'active');
  });

  it('o esquema intermediário ainda responde às consultas da imagem anterior (deploy sem atomicidade)', () => {
    assert.equal(psql(`SELECT count(*) FROM (SELECT credential_ref, coletor_ref, connection_id FROM automation.fontes_de_coleta(50)) f WHERE credential_ref IS NULL`), '1');
    assert.equal(psql(`SELECT count(*) FROM (SELECT credential_ref, coletor_ref, executor_ref FROM integrations.connections) c`), '4');
    assert.equal(psql(`SELECT count(*) FROM (SELECT credential_ref FROM automation.sync_queue(5, 28)) s`), '0');
    assert.equal(psql(`SELECT count(*) FROM (SELECT credential_ref, executor_ref FROM automation.task_queue(1, NULL)) t`), '0');
    psql(`UPDATE integrations.connections SET coletor_ref = NULL WHERE id = '${GA4}'`);
  });

  it('a 0123 sem RELEASE_CORTE_AUTORIZADO é recusada pelo portão num banco que já tem migrações', () => {
    copyFileSync('db/migrations/0123_remover_legado_do_cofre.sql', join(pasta, '0123_remover_legado_do_cofre.sql'));
    const r = tentarMigrar({ CORTE_GATE_ARQUIVO: 'db/corte-gate.txt', PREFLIGHT_MARCA: marcaDoPreflight, RELEASE_ID: RELEASE, RELEASE_CORTE_AUTORIZADO: '0' });
    assert.equal(r.status, 3, r.saida);
    assert.match(r.saida, /corte bloqueado: pendentes do corte: 0123_remover_legado_do_cofre\.sql/);
    assert.equal(foiAplicada('0123_remover_legado_do_cofre.sql'), false);
    assert.equal(tabelaDoCorteExiste(), true);
  });

  it('a 0123 autorizada recusa enquanto houver conexão sem limpo_em', () => {
    const r = tentarMigrar(autorizado());
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /ainda tem conexões sem limpo_em/);
    assert.equal(foiAplicada('0123_remover_legado_do_cofre.sql'), false);
    assert.equal(tabelaDoCorteExiste(), true);
  });

  it('a 0123 autorizada recusa limpa mas com ponteiro do n8n voltando numa conexão', () => {
    psql('UPDATE integrations.corte_para_cofre_refs SET limpo_em = now()');
    psql(`UPDATE integrations.connections SET credential_ref = 'n8n:credential:voltou' WHERE id = '${GOOGLE}'`);
    const r = tentarMigrar(autorizado());
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /ainda há conexão com ponteiro do n8n/);
    assert.equal(foiAplicada('0123_remover_legado_do_cofre.sql'), false);
    assert.equal(tabelaDoCorteExiste(), true);
  });

  it('a 0123 autorizada, com a limpeza concluída e sem ponteiro, remove a tabela do corte e as colunas legadas', () => {
    psql(`UPDATE integrations.connections SET credential_ref = NULL WHERE id = '${GOOGLE}'`);
    const r = tentarMigrar(autorizado());
    assert.equal(r.status, 0, r.saida);
    assert.equal(foiAplicada('0123_remover_legado_do_cofre.sql'), true);
    assert.equal(psql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = 'integrations' AND table_name = 'connections' AND column_name IN ('credential_ref', 'coletor_ref', 'executor_ref')`), '0');
    assert.equal(tabelaDoCorteExiste(), false);
    assert.equal(psql(`SELECT count(*) FROM automation.fontes_de_coleta(50)`), '1');
  });
});
