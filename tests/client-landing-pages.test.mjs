import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { PG_CONTAINER as CONTAINER } from './apoio/pgContainer.mjs';

const sufixo = randomBytes(4).toString('hex');

const variavel = (nome) => {
  if (process.env[nome]) return process.env[nome];
  const linha = readFileSync('.env', 'utf8')
    .split('\n')
    .find((candidata) => candidata.startsWith(`${nome}=`));
  return linha.slice(nome.length + 1);
};

const psql = (usuario, senha, sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', ...(senha ? ['-e', `PGPASSWORD=${senha}`] : []), CONTAINER, 'psql', '-U', usuario, ...(senha ? ['-h', '127.0.0.1'] : []), '-d', 'tria', '-v', 'VERBOSITY=verbose', '-qtAc', sql],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();

const ultimaLinha = (texto) => texto.split('\n').at(-1).trim();
const dono = (sql) => ultimaLinha(psql('postgres', null, sql));
const contexto = (organizacao, clientes, usuario) =>
  `SET app.organization_id = '${organizacao}'; SET app.client_ids = '${clientes}'; SET app.user_id = '${usuario ?? ''}'; `;
const comoApp = (organizacao, clientes, usuario, sql) => ultimaLinha(psql('orla_app', variavel('APP_DB_PASSWORD'), contexto(organizacao, clientes, usuario) + sql));
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
    const existe = dono("SELECT to_regclass('core.client_landing_pages') IS NOT NULL");
    return existe === 't' ? null : `container ${CONTAINER} sem a migração 0148 aplicada`;
  } catch (falha) {
    return `Postgres do container ${CONTAINER} indisponível (${String(falha.message).split('\n')[0]})`;
  }
})();

if (disponibilidade && process.env.CI) {
  describe('Landing pages e WhatsApp do cliente (migração 0148)', () => {
    it('o Postgres do harness precisa estar disponível e migrado no CI', () => {
      assert.fail(disponibilidade);
    });
  });
}

describe('Landing pages e WhatsApp do cliente (migração 0148)', { concurrency: false, skip: disponibilidade && !process.env.CI ? disponibilidade : disponibilidade ? true : false }, () => {
  const ids = {};
  const criadas = { orgs: [], clientes: [], usuarios: [] };

  const org = (nome) => {
    const id = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Destino ${nome} ${sufixo}', 'destino-${nome}-${sufixo}', 'agency') RETURNING id`);
    criadas.orgs.push(id);
    return id;
  };
  const cliente = (organizacao, nome) => {
    const id = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${organizacao}', '${nome} ${sufixo}', 'leads') RETURNING id`);
    criadas.clientes.push(id);
    return id;
  };
  const usuario = (nome) => {
    const id = dono(`INSERT INTO core.users (email, name) VALUES ('destino-${nome}-${sufixo}@tria.local', '${nome}') RETURNING id`);
    criadas.usuarios.push(id);
    return id;
  };
  const membro = (organizacao, quem, papel) => dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${organizacao}', '${quem}', '${papel}') RETURNING id`);

  const novaPagina = (quem, url, org = ids.orgA, cli = ids.cliA, clientes = '*', organizacaoDaSessao = org) =>
    comoApp(organizacaoDaSessao, clientes, quem, `INSERT INTO core.client_landing_pages (organization_id, client_id, url, rotulo) VALUES ('${org}', '${cli}', '${url}', 'Página') RETURNING id`);
  const url = () => `https://loja-${randomBytes(4).toString('hex')}.com.br/oferta`;

  before(() => {
    ids.orgA = org('a');
    ids.orgB = org('b');
    ids.cliA = cliente(ids.orgA, 'cli-a');
    ids.cliA2 = cliente(ids.orgA, 'cli-a2');
    ids.cliB = cliente(ids.orgB, 'cli-b');
    ids.dono = usuario('dono');
    ids.operador = usuario('operador');
    ids.leitor = usuario('leitor');
    ids.donoB = usuario('dono-b');
    membro(ids.orgA, ids.dono, 'owner');
    membro(ids.orgA, ids.operador, 'operator');
    membro(ids.orgA, ids.leitor, 'viewer');
    membro(ids.orgB, ids.donoB, 'owner');
  });

  after(() => {
    for (const id of criadas.clientes) dono(`DELETE FROM core.clients WHERE id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.members WHERE user_id = '${id}'`);
    for (const id of criadas.usuarios) dono(`DELETE FROM core.users WHERE id = '${id}'`);
    for (const id of criadas.orgs) dono(`DELETE FROM core.organizations WHERE id = '${id}'`);
  });

  it('owner e operador criam e leem a página do próprio cliente; leitor lê mas não grava', () => {
    const doOwner = novaPagina(ids.dono, url());
    novaPagina(ids.operador, url());
    const negada = recusa(() => novaPagina(ids.leitor, url()));
    assert.match(negada ?? '', /42501.*owner, admin ou operator/s);
    assert.equal(comoApp(ids.orgA, '*', ids.leitor, `SELECT count(*) FROM core.client_landing_pages WHERE client_id = '${ids.cliA}'`), '2');
    assert.equal(comoApp(ids.orgA, '*', ids.leitor, `SELECT organization_id || '/' || client_id FROM core.client_landing_pages WHERE id = '${doOwner}'`), `${ids.orgA}/${ids.cliA}`);
  });

  it('sem usuário na sessão não grava', () => {
    assert.match(recusa(() => novaPagina('', url())) ?? '', /42501/);
  });

  it('outra organização não vê nem grava nas páginas de A', () => {
    const id = novaPagina(ids.dono, url());
    assert.equal(comoApp(ids.orgB, '*', ids.donoB, `SELECT count(*) FROM core.client_landing_pages WHERE id = '${id}'`), '0');
    assert.equal(comoApp(ids.orgB, '*', ids.donoB, `SELECT count(*) FROM core.client_landing_pages`), '0');
    assert.match(recusa(() => novaPagina(ids.donoB, url(), ids.orgA, ids.cliA, '*', ids.orgB)) ?? '', /42501|42501|row-level security/);
    assert.match(recusa(() => novaPagina(ids.donoB, url(), ids.orgB, ids.cliA, '*', ids.orgB)) ?? '', /42501|row-level security/);
    assert.equal(comoApp(ids.orgB, '*', ids.donoB, `WITH a AS (UPDATE core.client_landing_pages SET arquivada_em = now() WHERE id = '${id}' RETURNING id) SELECT count(*) FROM a`), '0');
    assert.equal(dono(`SELECT arquivada_em IS NULL FROM core.client_landing_pages WHERE id = '${id}'`), 't');
  });

  it('recorte de clientes: sessão restrita a outro cliente não vê nem grava', () => {
    const id = novaPagina(ids.dono, url(), ids.orgA, ids.cliA, ids.cliA);
    assert.equal(comoApp(ids.orgA, ids.cliA2, ids.dono, `SELECT count(*) FROM core.client_landing_pages WHERE id = '${id}'`), '0');
    assert.match(recusa(() => novaPagina(ids.dono, url(), ids.orgA, ids.cliA, ids.cliA2)) ?? '', /42501|row-level security/);
  });

  it('URL ativa é única por cliente; arquivar libera a URL; não há DELETE nem troca de URL', () => {
    const endereco = url();
    const id = novaPagina(ids.dono, endereco);
    assert.match(recusa(() => novaPagina(ids.dono, endereco.toUpperCase().replace('HTTPS', 'https'))) ?? '', /23505.*client_landing_pages_url_ativa/s);
    novaPagina(ids.dono, endereco, ids.orgA, ids.cliA2);
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, `UPDATE core.client_landing_pages SET url = 'https://outra.com.br/' WHERE id = '${id}'`)) ?? '', /42501|permission denied/);
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, `DELETE FROM core.client_landing_pages WHERE id = '${id}'`)) ?? '', /42501|permission denied/);
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.leitor, `UPDATE core.client_landing_pages SET arquivada_em = now() WHERE id = '${id}'`)) ?? '', /42501.*owner, admin ou operator/s);
    comoApp(ids.orgA, '*', ids.operador, `UPDATE core.client_landing_pages SET arquivada_em = now() WHERE id = '${id}'`);
    assert.equal(dono(`SELECT arquivada_em IS NOT NULL FROM core.client_landing_pages WHERE id = '${id}'`), 't');
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, `UPDATE core.client_landing_pages SET arquivada_em = now() WHERE id = '${id}'`)) ?? '', /restrict_violation|arquiva/);
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, `UPDATE core.client_landing_pages SET arquivada_em = NULL WHERE id = '${id}'`)) ?? '', /restrict_violation|arquiva/);
    novaPagina(ids.dono, endereco);
  });

  it('CHECK recusa URL que não é https ou tem credencial embutida', () => {
    for (const ruim of ['http://loja.com.br/', ['https://u', 'p@loja.com.br/'].join(':'), 'https:///x', 'ftp://loja.com.br/']) {
      assert.match(recusa(() => novaPagina(ids.dono, ruim)) ?? '', /23514.*client_landing_pages_url_check/s, ruim);
    }
  });

  it('WhatsApp do cliente: E.164 por CHECK e isolamento entre organizações', () => {
    comoApp(ids.orgA, '*', ids.dono, `UPDATE core.clients SET whatsapp = '+5511999998888' WHERE id = '${ids.cliA}'`);
    assert.equal(comoApp(ids.orgA, '*', ids.leitor, `SELECT whatsapp FROM core.clients WHERE id = '${ids.cliA}'`), '+5511999998888');
    assert.match(recusa(() => comoApp(ids.orgA, '*', ids.dono, `UPDATE core.clients SET whatsapp = '11999998888' WHERE id = '${ids.cliA}'`)) ?? '', /23514.*clients_whatsapp_e164/s);
    assert.equal(comoApp(ids.orgB, '*', ids.donoB, `WITH a AS (UPDATE core.clients SET whatsapp = '+5511888887777' WHERE id = '${ids.cliA}' RETURNING id) SELECT count(*) FROM a`), '0');
    assert.equal(comoApp(ids.orgB, '*', ids.donoB, `SELECT count(*) FROM core.clients WHERE id = '${ids.cliA}'`), '0');
    assert.equal(dono(`SELECT whatsapp FROM core.clients WHERE id = '${ids.cliA}'`), '+5511999998888');
  });

  it('planos do mesmo tipo coexistem e exigem plataformas, WhatsApp e página do mesmo cliente', () => {
    const pagina = novaPagina(ids.dono, url());
    const paginaDeOutroCliente = novaPagina(ids.dono, url(), ids.orgA, ids.cliA2);
    const plano = (extra) =>
      comoApp(ids.orgA, '*', ids.dono, `INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key, plataformas, whatsapp, landing_page_id) VALUES ('${ids.orgA}', '${ids.cliA}', 'aquisicao', ${extra.plataformas ?? "ARRAY['meta','google']"}, '${extra.whatsapp ?? '+5511999998888'}', '${extra.pagina ?? pagina}') RETURNING id`);
    const primeiro = plano({});
    const segundo = plano({});
    assert.notEqual(primeiro, segundo);
    assert.match(recusa(() => plano({ plataformas: "ARRAY['foo']" })) ?? '', /23514.*strategy_plans_plataformas_validas/s);
    assert.match(recusa(() => plano({ plataformas: 'ARRAY[]::text[]' })) ?? '', /23514.*strategy_plans_plataformas_validas/s);
    assert.match(recusa(() => plano({ whatsapp: '119' })) ?? '', /23514.*strategy_plans_whatsapp_e164/s);
    assert.match(recusa(() => plano({ pagina: paginaDeOutroCliente })) ?? '', /23503.*strategy_plans_landing_page_fk/s);
  });
});
