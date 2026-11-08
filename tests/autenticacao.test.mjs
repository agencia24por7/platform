import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, browse, ensureUser, makeOwner, signIn, signOut } from './helpers.mjs';

const query = (sql) =>
  execFileSync('docker', ['exec', 'tria-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql])
    .toString()
    .trim()
    .split('\n')[0]
    .trim();

const PROTEGIDAS = ['/clientes', '/integracoes', '/automacoes', '/comecar', '/clientes/novo'];

describe('porta de entrada', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
  });

  it('visitante sem sessão vai direto para o login do Google', async () => {
    signOut();
    for (const rota of PROTEGIDAS) {
      const response = await browse(rota);
      assert.equal(response.status, 307, `${rota} deveria redirecionar`);
      assert.match(
        response.headers.get('location') ?? '',
        /\/api\/auth\/google\/start/,
        `${rota} deveria ir direto para o login do Google`,
      );
    }
  });

  it('o login sem credencial configurada cai na entrada com o motivo', async () => {
    signOut();
    const response = await browse('/api/auth/google/start');
    const destino = response.headers.get('location') ?? '';
    assert.ok(
      destino.includes('accounts.google.com') || destino.includes('/entrar?erro=indisponivel'),
      `destino inesperado: ${destino}`,
    );
  });

  it('a entrada fica aberta e oferece o Google', async () => {
    signOut();
    const response = await browse('/entrar');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Entrar com Google|credencial de login/);
  });

  it('a saúde continua aberta para o monitoramento', async () => {
    signOut();
    const response = await browse('/api/health');
    assert.equal(response.status, 200);
  });

  it('sessão forjada com outro segredo é recusada', async () => {
    signOut();
    const falsa = 'tria_sessao=ZmFsc28.assinaturaforjada';
    const response = await fetch(`${BASE}/clientes`, { headers: { Cookie: falsa }, redirect: 'manual' });
    assert.notEqual(response.status, 200);
  });
});

describe('isolamento entre organizações', { concurrency: false }, () => {
  let organizacaoA = '';
  let usuarioB = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    query(
      'TRUNCATE core.members, integrations.connection_accounts, integrations.ad_accounts, integrations.connections, core.clients, audit.audit_log, core.organizations RESTART IDENTITY CASCADE',
    );

    organizacaoA = query(
      "INSERT INTO core.organizations (name, slug, type) VALUES ('Agência A', 'agencia-a', 'agency') RETURNING id",
    );
    const usuarioA = ensureUser('a@tria.local');
    makeOwner(usuarioA, organizacaoA);

    usuarioB = ensureUser('b@tria.local');
  });

  it('usuário sem vínculo não enxerga a organização alheia', async () => {
    signIn(usuarioB);
    const response = await browse('/clientes');
    assert.notEqual(response.status, 200);
    assert.match(response.headers.get('location') ?? '', /\/organizacoes\/nova|\/entrar/);
  });

  it('usuário vinculado enxerga a própria organização', async () => {
    signIn(ensureUser('a@tria.local'));
    const response = await browse('/clientes');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Agência A/);
  });

  it('o vínculo de dono é único por organização', async () => {
    const total = query(
      `SELECT count(*) FROM core.members WHERE organization_id = '${organizacaoA}' AND role = 'owner'`,
    );
    assert.equal(total, '1');
  });
});
