import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, browse, ensureUser, signIn, signOut } from './helpers.mjs';

const follow = (path) => browse(path);

const resetToFirstRun = () =>
  execFileSync('docker', [
    'exec', 'tria-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-tAc',
    'TRUNCATE metrics.metrics_restatements, metrics.metrics_daily, automation.sync_runs, integrations.connection_accounts, integrations.ad_accounts, integrations.connections, core.clients, audit.audit_log, core.organizations RESTART IDENTITY CASCADE',
  ]);

describe('tela de conexão e fluxo OAuth', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    resetToFirstRun();
    signIn(ensureUser());
  });

  it('a raiz leva ao assistente quando não há organização', async () => {
    const response = await follow('/');
    assert.match(response.headers.get('location') ?? '', /\/comecar/);
  });

  it('a tela mostra as duas plataformas e o botão de conectar', async () => {
    const html = await browse(`/comecar?passo=conectar`).then((r) => r.text());
    assert.match(html, /Google Ads/);
    assert.match(html, /Meta Ads/);
    assert.match(html, /Conectar/);
    assert.match(html, /Por que preciso conectar/);
    assert.match(html, /Passo 1 de 3/);
  });

  it('não pede nenhum segredo na tela', async () => {
    const html = await browse(`/comecar?passo=conectar`).then((r) => r.text());
    assert.ok(!/type="password"/.test(html));
    assert.ok(!/client_secret|developer.?token/i.test(html.replace(/token fica cifrado/gi, '')));
  });

  it('oferece saída para quem não tem acesso agora', async () => {
    const html = await browse(`/comecar?passo=conectar`).then((r) => r.text());
    assert.match(html, /Cadastrar manualmente|Ir para o painel/);
  });

  it('informa quando o aplicativo ainda não está habilitado, sem sair do ambiente', async () => {
    const response = await follow('/api/oauth/google/start');
    assert.equal(response.status, 307);
    const location = response.headers.get('location') ?? '';
    assert.match(location, /indisponivel=google/);
    assert.ok(!location.includes('accounts.google.com'));
  });

  it('a seleção de contas existe e trata ausência de descoberta', async () => {
    const response = await browse(`/comecar/contas`);
    assert.ok([200, 307].includes(response.status), `status inesperado ${response.status}`);
  });

  it('recusa plataforma desconhecida', async () => {
    const response = await follow('/api/oauth/tiktok/start');
    assert.match(response.headers.get('location') ?? '', /plataforma_desconhecida/);
  });

  it('o início amarra a organização no cookie de estado', async () => {
    const response = await follow('/api/oauth/google/start');
    const cookie = response.headers.get('set-cookie') ?? '';
    if (cookie.includes('tria_oauth_state')) {
      assert.match(cookie, /tria_oauth_state=[^;]*\|/, 'o cookie precisa carregar o binding');
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=lax/i);
    }
  });

  it('recusa callback com state forjado', async () => {
    const response = await follow('/api/oauth/google/callback?state=forjado&code=abc');
    assert.match(response.headers.get('location') ?? '', /estado_invalido/);
  });

  it('recusa callback sem state', async () => {
    const response = await follow('/api/oauth/google/callback?code=abc');
    assert.match(response.headers.get('location') ?? '', /estado_invalido/);
  });

  it('não aceita redirecionamento externo no returnTo', async () => {
    const payloads = [
      'https://evil.com',
      '//evil.com',
      '/\t/evil.com',
      '/\n//evil.com',
      '/\\evil.com',
      'http:evil.com',
    ];

    for (const payload of payloads) {
      const response = await follow(`/api/oauth/google/start?returnTo=${encodeURIComponent(payload)}`);
      const location = response.headers.get('location') ?? '';
      assert.ok(!location.includes('evil.com'), `vazou com ${JSON.stringify(payload)}: ${location}`);
    }
  });

  it('o callback nunca redireciona para fora da origem do app', async () => {
    const response = await follow('/api/oauth/google/callback?state=x&code=y&returnTo=https://evil.com');
    const location = response.headers.get('location') ?? '';
    assert.ok(location.startsWith(BASE), `redirecionou para ${location}`);
  });
});

describe('autorizar plataforma exige administrar a organização', { concurrency: false }, () => {
  let organizacao = '';

  const query = (sql) =>
    execFileSync('docker', ['exec', '-i', 'tria-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')[0]
      .trim();

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    organizacao = query(
      `INSERT INTO core.organizations (name, slug, type)
       VALUES ('Guarda do OAuth', 'guarda-oauth', 'agency')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
  });

  const entrarComo = (papel) => {
    const usuario = ensureUser(`${papel}.guarda@tria.local`);
    query(
      `INSERT INTO core.members (organization_id, user_id, role)
       VALUES ('${organizacao}', '${usuario}', '${papel}')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = '${papel}', revoked_at = NULL
       RETURNING id`,
    );
    signIn(usuario);
    return usuario;
  };

  it('quem enxerga ou opera não inicia autorização', async () => {
    for (const papel of ['viewer', 'operator']) {
      entrarComo(papel);
      const resposta = await browse('/api/oauth/google/start');
      const destino = resposta.headers.get('location') ?? '';
      assert.ok(
        !destino.includes('accounts.google.com') && !destino.includes('indisponivel'),
        `${papel} não podia passar do portão: foi para ${destino}`,
      );
      assert.match(destino, /integracoes\?aviso=/, `${papel} devia voltar com o aviso`);
    }
  });

  it('quem administra passa do portão', async () => {
    entrarComo('admin');
    const resposta = await browse('/api/oauth/google/start');
    const destino = resposta.headers.get('location') ?? '';
    assert.ok(
      destino.includes('accounts.google.com') || destino.includes('indisponivel=google'),
      `admin devia seguir para o provedor ou esbarrar só na configuração: foi para ${destino}`,
    );
  });

  it('acesso recortado não inicia autorização', async () => {
    const usuario = ensureUser('recortada.guarda@tria.local');
    const membro = query(
      `INSERT INTO core.members (organization_id, user_id, role)
       VALUES ('${organizacao}', '${usuario}', 'admin')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'admin', revoked_at = NULL
       RETURNING id`,
    );
    const cliente = query(
      `INSERT INTO core.clients (organization_id, name, business_model)
       VALUES ('${organizacao}', 'Cliente da Guarda', 'leads')
       ON CONFLICT (organization_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    query(
      `INSERT INTO core.member_clients (member_id, client_id) VALUES ('${membro}', '${cliente}')
       ON CONFLICT (member_id, client_id) DO UPDATE SET revoked_at = NULL`,
    );

    signIn(usuario);
    const resposta = await browse('/api/oauth/google/start');
    assert.match(resposta.headers.get('location') ?? '', /\/clientes/, 'o recorte devia ser barrado');

    query(`UPDATE core.member_clients SET revoked_at = now() WHERE member_id = '${membro}'`);
    signOut();
  });
});
