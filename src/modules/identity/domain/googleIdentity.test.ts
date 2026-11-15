import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSigninUrl, decodeIdTokenClaims, identityFromClaims } from './googleIdentity.ts';

const AUDIENCIA = '123.apps.googleusercontent.com';
const AGORA = 1_700_000_000_000;

function tokenCom(claims: Record<string, unknown>): string {
  const corpo = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `cabecalho.${corpo}.assinatura`;
}

const validas = {
  iss: 'https://accounts.google.com',
  aud: AUDIENCIA,
  exp: AGORA / 1000 + 600,
  email: 'bruno@agencia24por7.com',
  email_verified: true,
  name: 'Bruno',
  picture: 'https://lh3.googleusercontent.com/foto',
};

describe('leitura do id_token', () => {
  it('lê as declarações essenciais', () => {
    const claims = decodeIdTokenClaims(tokenCom(validas));
    assert.equal(claims?.email, 'bruno@agencia24por7.com');
    assert.equal(claims?.emailVerified, true);
  });

  it('recusa token malformado', () => {
    assert.equal(decodeIdTokenClaims('só.duas'), null);
    assert.equal(decodeIdTokenClaims('a.não-é-base64-json!.c'), null);
  });

  it('descarta foto que não é https', () => {
    const claims = decodeIdTokenClaims(tokenCom({ ...validas, picture: 'http://inseguro/foto' }));
    assert.equal(claims?.picture, null);
  });

  it('lê o nonce quando o token traz um', () => {
    const claims = decodeIdTokenClaims(tokenCom({ ...validas, nonce: 'n-abc' }));
    assert.equal(claims?.nonce, 'n-abc');
  });

  it('nonce ausente ou vazio vira null — e o callback recusa', () => {
    assert.equal(decodeIdTokenClaims(tokenCom(validas))?.nonce, null);
    assert.equal(decodeIdTokenClaims(tokenCom({ ...validas, nonce: '' }))?.nonce, null);
    assert.equal(decodeIdTokenClaims(tokenCom({ ...validas, nonce: 42 }))?.nonce, null);
  });
});

describe('identidade a partir das declarações', () => {
  const claimsDe = (extra: Record<string, unknown> = {}) =>
    decodeIdTokenClaims(tokenCom({ ...validas, ...extra }))!;

  it('aceita declarações íntegras', () => {
    assert.equal(identityFromClaims(claimsDe(), AUDIENCIA, AGORA)?.email, 'bruno@agencia24por7.com');
  });

  it('recusa audiência de outro aplicativo', () => {
    assert.equal(identityFromClaims(claimsDe(), 'outro.apps.googleusercontent.com', AGORA), null);
  });

  it('recusa emissor que não é o Google', () => {
    assert.equal(identityFromClaims(claimsDe({ iss: 'https://evil.example' }), AUDIENCIA, AGORA), null);
  });

  it('recusa token expirado', () => {
    assert.equal(identityFromClaims(claimsDe({ exp: AGORA / 1000 - 1 }), AUDIENCIA, AGORA), null);
  });

  it('recusa e-mail não confirmado pelo provedor', () => {
    assert.equal(identityFromClaims(claimsDe({ email_verified: false }), AUDIENCIA, AGORA), null);
  });

  it('recusa e-mail inválido', () => {
    assert.equal(identityFromClaims(claimsDe({ email: 'sem-arroba' }), AUDIENCIA, AGORA), null);
  });
});

describe('url de login', () => {
  const url = new URL(
    buildSigninUrl({
      clientId: AUDIENCIA,
      redirectUri: 'https://platform.agencia24por7.com/api/auth/google/callback',
      state: 'abc',
      nonce: 'xyz',
      challenge: 'desafio',
    }),
  );

  it('pede apenas identidade, nunca escopo de anúncios', () => {
    assert.equal(url.searchParams.get('scope'), 'openid email profile');
    assert.ok(!url.searchParams.get('scope')?.includes('adwords'));
  });

  it('usa PKCE com S256', () => {
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('code_challenge'), 'desafio');
  });

  it('leva state e nonce', () => {
    assert.equal(url.searchParams.get('state'), 'abc');
    assert.equal(url.searchParams.get('nonce'), 'xyz');
  });
});
