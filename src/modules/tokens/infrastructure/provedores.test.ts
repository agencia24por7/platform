import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';

const {
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  META_PERMISSIONS_URL,
  createFabricaDeProvedores,
  createProvedorGoogle,
  createProvedorMeta,
  classificarErroGoogle,
  classificarErroMeta,
} = await import('./provedores.ts');
const { META_GRAPH_BASE } = await import('@/modules/connections/domain/metaGraphVersion.ts');

const AGORA = Date.parse('2026-11-20T12:00:00Z');
const APP = () => ({ clientId: 'cliente-123', clientSecret: 'segredo-do-app' });

type Pedido = { url: string; init: RequestInit };

function buscarCom(status: number, corpo: unknown) {
  const pedidos: Pedido[] = [];
  const buscar = async (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    return new Response(corpo === undefined ? '' : JSON.stringify(corpo), { status });
  };
  return { buscar, pedidos };
}

describe('provedor Google', () => {
  it('renova com grant refresh_token por formulário e calcula a expiração', async () => {
    const { buscar, pedidos } = buscarCom(200, { access_token: 'ya29.novo', expires_in: 3599, token_type: 'Bearer' });
    const resultado = await createProvedorGoogle('ga4', APP, buscar, () => AGORA).renovar('1//refresh');
    assert.ok(resultado.ok);
    assert.equal(resultado.value.accessToken, 'ya29.novo');
    assert.equal(resultado.value.expiraEm?.getTime(), AGORA + 3_599_000);
    assert.equal(resultado.value.novoSegredo, undefined);

    assert.equal(pedidos[0]?.url, GOOGLE_TOKEN_URL);
    assert.equal(pedidos[0]?.init.method, 'POST');
    const corpo = new URLSearchParams(String(pedidos[0]?.init.body));
    assert.deepEqual(Object.fromEntries(corpo), {
      grant_type: 'refresh_token',
      refresh_token: '1//refresh',
      client_id: 'cliente-123',
      client_secret: 'segredo-do-app',
    });
    assert.ok(pedidos[0]?.init.signal);
  });

  it('classifica invalid_grant como reautorizar, 5xx como transitória e invalid_client como configuração', async () => {
    const reauth = await createProvedorGoogle('google', APP, buscarCom(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }).buscar).renovar('1//r');
    assert.deepEqual(reauth, { ok: false, error: { natureza: 'reautorizar', codigo: 'invalid_grant' } });
    assert.deepEqual(classificarErroGoogle(503, null), { natureza: 'transitoria', codigo: 'http_503' });
    assert.deepEqual(classificarErroGoogle(401, { error: 'invalid_client' }), { natureza: 'configuracao', codigo: 'invalid_client' });
  });

  it('falha de rede é transitória e a mensagem não carrega segredo', async () => {
    const provedor = createProvedorGoogle('google', APP, async () => {
      throw new Error('falhou com 1//refresh-secreto');
    });
    const resultado = await provedor.renovar('1//refresh-secreto');
    assert.deepEqual(resultado, { ok: false, error: { natureza: 'transitoria', codigo: 'rede' } });
    assert.ok(!JSON.stringify(resultado).includes('secreto'));
  });

  it('sem client id/segredo configurado não chama a rede', async () => {
    const { buscar, pedidos } = buscarCom(200, {});
    const resultado = await createProvedorGoogle('google', () => ({}), buscar).renovar('1//r');
    assert.deepEqual(resultado, { ok: false, error: { natureza: 'configuracao', codigo: 'app_sem_credencial' } });
    assert.equal(pedidos.length, 0);
  });

  it('revoga no endpoint oficial; token já inválido conta como revogado', async () => {
    const ok = buscarCom(200, {});
    assert.deepEqual(await createProvedorGoogle('google', APP, ok.buscar).revogar('1//r'), { ok: true, value: 'revogado' });
    assert.equal(ok.pedidos[0]?.url, GOOGLE_REVOKE_URL);
    assert.equal(new URLSearchParams(String(ok.pedidos[0]?.init.body)).get('token'), '1//r');
    const jaInvalido = buscarCom(400, { error: 'invalid_token' });
    assert.deepEqual(await createProvedorGoogle('google', APP, jaInvalido.buscar).revogar('1//r'), { ok: true, value: 'revogado' });
  });
});

describe('provedor Meta', () => {
  it('troca o token de longa duração por outro (fb_exchange_token) na versão da Graph do repositório', async () => {
    const { buscar, pedidos } = buscarCom(200, { access_token: 'EAA-novo', token_type: 'bearer', expires_in: 5_183_944 });
    const resultado = await createProvedorMeta('meta', APP, buscar, () => AGORA).renovar('EAA-atual');
    assert.ok(resultado.ok);
    assert.equal(resultado.value.novoSegredo, 'EAA-novo');
    assert.equal(resultado.value.segredoExpiraEm?.getTime(), AGORA + 5_183_944_000);
    assert.equal(pedidos[0]?.url, `${META_GRAPH_BASE}/oauth/access_token`);
    const corpo = new URLSearchParams(String(pedidos[0]?.init.body));
    assert.equal(corpo.get('grant_type'), 'fb_exchange_token');
    assert.equal(corpo.get('fb_exchange_token'), 'EAA-atual');
    assert.ok(!pedidos[0]?.url.includes('EAA-atual'));
  });

  it('sem expires_in assume os 60 dias do token de longa duração', async () => {
    const resultado = await createProvedorMeta('meta', APP, buscarCom(200, { access_token: 'EAA-novo' }).buscar, () => AGORA).renovar('EAA');
    assert.ok(resultado.ok);
    assert.equal(resultado.value.segredoExpiraEm?.getTime(), AGORA + 60 * 86_400_000);
  });

  it('190/OAuthException vira reautorizar; limite de uso é transitório', () => {
    assert.deepEqual(classificarErroMeta(400, { error: { code: 190, type: 'OAuthException', message: 'Error validating access token' } }), {
      natureza: 'reautorizar',
      codigo: 'meta_190',
    });
    assert.deepEqual(classificarErroMeta(400, { error: { code: 17, type: 'OAuthException' } }), { natureza: 'transitoria', codigo: 'meta_17' });
    assert.deepEqual(classificarErroMeta(400, { error: { code: 10, type: 'OAuthException' } }), { natureza: 'reautorizar', codigo: 'meta_10' });
    assert.deepEqual(classificarErroMeta(500, null), { natureza: 'transitoria', codigo: 'http_500' });
  });

  it('revoga com DELETE /me/permissions e o token no cabeçalho, nunca na URL', async () => {
    const { buscar, pedidos } = buscarCom(200, { success: true });
    assert.deepEqual(await createProvedorMeta('meta', APP, buscar).revogar('EAA-x'), { ok: true, value: 'revogado' });
    assert.equal(pedidos[0]?.url, META_PERMISSIONS_URL);
    assert.equal(pedidos[0]?.init.method, 'DELETE');
    assert.equal((pedidos[0]?.init.headers as Record<string, string>).Authorization, 'Bearer EAA-x');
  });
});

describe('fábrica de provedores', () => {
  it('escolhe a família pela plataforma e pelo tipo do segredo', async () => {
    const fabrica = createFabricaDeProvedores(APP, buscarCom(200, {}).buscar);
    assert.ok(fabrica('youtube', 'oauth_refresh'));
    assert.ok(fabrica('leadads', 'oauth_long_lived'));
    assert.equal(fabrica('meta', 'oauth_refresh'), null);
    assert.equal(fabrica('google', 'oauth_long_lived'), null);
    const chave = fabrica('zapi', 'api_key')!;
    assert.deepEqual(await chave.renovar('inst:tok'), { ok: true, value: { accessToken: 'inst:tok', expiraEm: null } });
    assert.deepEqual(await chave.revogar('inst:tok'), { ok: true, value: 'sem_suporte' });
  });
});
