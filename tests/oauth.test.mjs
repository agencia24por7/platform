import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp } from './helpers.mjs';

const follow = (path) => fetch(`${BASE}${path}`, { redirect: 'manual' });

const resetToFirstRun = () =>
  execFileSync('docker', [
    'exec', 'tria-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-tAc',
    'TRUNCATE metrics.metrics_restatements, metrics.metrics_daily, automation.sync_runs, integrations.connection_accounts, integrations.ad_accounts, integrations.connections, core.clients, audit.audit_log, core.organizations RESTART IDENTITY CASCADE',
  ]);

describe('tela de conexão e fluxo OAuth', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    resetToFirstRun();
  });

  it('a raiz leva ao assistente quando não há organização', async () => {
    const response = await follow('/');
    assert.match(response.headers.get('location') ?? '', /\/comecar/);
  });

  it('a tela mostra as duas plataformas e o botão de conectar', async () => {
    const html = await fetch(`${BASE}/comecar?passo=conectar`).then((r) => r.text());
    assert.match(html, /Google Ads/);
    assert.match(html, /Meta Ads/);
    assert.match(html, /Conectar/);
    assert.match(html, /Por que preciso conectar/);
    assert.match(html, /Passo 1 de 3/);
  });

  it('não pede nenhum segredo na tela', async () => {
    const html = await fetch(`${BASE}/comecar?passo=conectar`).then((r) => r.text());
    assert.ok(!/type="password"/.test(html));
    assert.ok(!/client_secret|developer.?token/i.test(html.replace(/token fica cifrado/gi, '')));
  });

  it('oferece saída para quem não tem acesso agora', async () => {
    const html = await fetch(`${BASE}/comecar?passo=conectar`).then((r) => r.text());
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
    const response = await fetch(`${BASE}/comecar/contas`, { redirect: 'manual' });
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
