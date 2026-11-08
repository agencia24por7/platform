import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resumirFalha } from './falhaDescoberta.ts';

const VERSAO_SUNSET = JSON.stringify({
  error: {
    code: 400,
    message: 'Request contains an invalid argument.',
    status: 'INVALID_ARGUMENT',
    details: [{ errors: [{ errorCode: { requestError: 'UNSUPPORTED_VERSION' } }] }],
  },
});

describe('resumo da falha da plataforma', () => {
  it('extrai o código de erro do Google, que é o que diz o que fazer', () => {
    assert.equal(resumirFalha(400, VERSAO_SUNSET), 'UNSUPPORTED_VERSION (HTTP 400)');
  });

  it('reconhece erro de autorização e de autenticação', () => {
    const semPermissao = '{"errorCode":{"authorizationError":"DEVELOPER_TOKEN_NOT_APPROVED"}}';
    assert.equal(resumirFalha(403, semPermissao), 'DEVELOPER_TOKEN_NOT_APPROVED (HTTP 403)');

    const semLogin = '{"errorCode":{"authenticationError":"OAUTH_TOKEN_EXPIRED"}}';
    assert.equal(resumirFalha(401, semLogin), 'OAUTH_TOKEN_EXPIRED (HTTP 401)');
  });

  it('cai para a mensagem quando não há código conhecido', () => {
    const corpo = '{"error":{"message":"Quota excedida para o projeto"}}';
    assert.equal(resumirFalha(429, corpo), 'Quota excedida para o projeto (HTTP 429)');
  });

  it('não explode com corpo vazio ou ilegível', () => {
    assert.equal(resumirFalha(500, ''), 'HTTP 500');
    assert.equal(resumirFalha(502, '<html>erro</html>'), 'HTTP 502');
  });

  it('não deixa mensagem gigante virar um resumo gigante', () => {
    const longa = `{"message":"${'x'.repeat(400)}"}`;
    assert.ok(resumirFalha(400, longa).length < 200);
  });
});
