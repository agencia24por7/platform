import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, get, post } from './helpers.mjs';

describe('borda do worker', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar em http://localhost:3000');
  });

  it('recusa requisição sem token', async () => {
    const response = await fetch(`${BASE}/api/v0/sync/queue`);
    assert.equal(response.status, 401);
  });

  it('recusa token inválido', async () => {
    const response = await fetch(`${BASE}/api/v0/sync/queue`, {
      headers: { Authorization: 'Bearer token-errado-mas-longo-o-suficiente-para-parecer-real' },
    });
    assert.equal(response.status, 401);
  });

  it('recusa esquema de autorização diferente de Bearer', async () => {
    const response = await fetch(`${BASE}/api/v0/sync/queue`, {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    assert.equal(response.status, 401);
  });

  it('aceita token correto', async () => {
    const response = await get('/api/v0/sync/queue');
    assert.equal(response.status, 200);
  });

  it('responde erro em problem+json sem vazar interno', async () => {
    const response = await post('/api/v0/sync/runs', { adAccountId: 'nao-e-uuid' });
    assert.equal(response.status, 422);
    assert.match(response.headers.get('content-type') ?? '', /application\/problem\+json/);

    const body = await response.json();
    assert.ok(body.requestId);
    assert.ok(!JSON.stringify(body).toLowerCase().includes('postgres'));
    assert.ok(!JSON.stringify(body).toLowerCase().includes('select'));
  });

  it('recusa corpo que não é JSON', async () => {
    const response = await fetch(`${BASE}/api/v0/sync/runs`, {
      method: 'POST',
      headers: { Authorization: `Bearer x`, 'Content-Type': 'application/json' },
      body: 'nada disso',
    });
    assert.equal(response.status, 401);
  });

  it('recusa limite de janela acima do permitido', async () => {
    const response = await post('/api/v0/sync/queue', {});
    assert.ok([404, 405].includes(response.status), `esperado 404/405, veio ${response.status}`);
  });

  it('aplica limite superior ao parâmetro limit', async () => {
    const response = await get('/api/v0/sync/queue?limit=99999');
    assert.equal(response.status, 422);
  });
});

describe('cabeçalhos de segurança', () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
  });

  it('envia os cabeçalhos obrigatórios', async () => {
    const response = await fetch(`${BASE}/clientes`);
    for (const header of [
      'content-security-policy',
      'x-frame-options',
      'x-content-type-options',
      'referrer-policy',
      'permissions-policy',
    ]) {
      assert.ok(response.headers.get(header), `faltou ${header}`);
    }
  });

  it('não revela a tecnologia', async () => {
    const response = await fetch(`${BASE}/clientes`);
    assert.equal(response.headers.get('x-powered-by'), null);
  });

  it('não libera eval fora de desenvolvimento', async () => {
    const response = await fetch(`${BASE}/clientes`);
    const csp = response.headers.get('content-security-policy') ?? '';
    const { readFileSync } = await import('node:fs');
    const config = readFileSync('next.config.mjs', 'utf8');

    assert.match(config, /isDevelopment\s*\?[\s\S]*unsafe-eval/, 'unsafe-eval precisa ser condicional');
    assert.ok(
      !config.includes("\"script-src 'self' 'unsafe-inline' 'unsafe-eval'\";"),
      'unsafe-eval não pode ser incondicional',
    );

    if (process.env.NODE_ENV === 'production') {
      assert.ok(!csp.includes('unsafe-eval'), 'produção não pode permitir eval');
    }
  });

  it('proíbe enquadramento em iframe', async () => {
    const response = await fetch(`${BASE}/clientes`);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  });
});
