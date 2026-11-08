import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PROVIDERS,
  authorizeUrlFor,
  hasRequiredScopes,
  isConfigured,
  isSafeReturnPath,
  longLivedExchangeUrl,
  parseTokenResponse,
  sameOrigin,
  tokenExchangeRequest,
} from './oauth.ts';

describe('isConfigured', () => {
  it('exige id e segredo no Google', () => {
    assert.ok(!isConfigured({}, 'google'));
    assert.ok(!isConfigured({ clientId: 'abc' }, 'google'));
    assert.ok(isConfigured({ clientId: 'abc', clientSecret: 'def' }, 'google'));
  });

  it('exige também o config_id no Meta, por causa do Login for Business', () => {
    assert.ok(!isConfigured({ clientId: 'abc', clientSecret: 'def' }, 'meta'));
    assert.ok(isConfigured({ clientId: 'abc', clientSecret: 'def', configId: '123' }, 'meta'));
  });
});

describe('authorizeUrlFor', () => {
  it('monta a URL do Google com offline e PKCE', () => {
    const url = new URL(
      authorizeUrlFor(PROVIDERS.google, {
        clientId: 'cliente',
        redirectUri: 'http://localhost:3000/api/oauth/google/callback',
        state: 'estado',
        codeChallenge: 'desafio',
      }),
    );
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('state'), 'estado');
    assert.match(url.searchParams.get('scope') ?? '', /adwords/);
  });

  it('não envia PKCE onde o provedor não usa', () => {
    const url = new URL(
      authorizeUrlFor(PROVIDERS.meta, {
        clientId: 'cliente',
        redirectUri: 'http://localhost:3000/api/oauth/meta/callback',
        state: 'estado',
        codeChallenge: 'desafio',
      }),
    );
    assert.equal(url.searchParams.get('code_challenge'), null);
  });

  it('no Meta usa config_id e não envia scope, como manda o Login for Business', () => {
    const url = new URL(
      authorizeUrlFor(PROVIDERS.meta, {
        clientId: 'c',
        redirectUri: 'http://localhost:3000/cb',
        state: 's',
        configId: 'config-123',
      }),
    );
    assert.equal(url.searchParams.get('config_id'), 'config-123');
    assert.equal(url.searchParams.get('scope'), null);
  });

  it('no Google envia o escopo restrito do Ads', () => {
    const url = new URL(
      authorizeUrlFor(PROVIDERS.google, {
        clientId: 'c',
        redirectUri: 'http://localhost:3000/cb',
        state: 's',
      }),
    );
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/adwords');
  });
});

describe('isSafeReturnPath', () => {
  it('aceita caminho interno', () => {
    assert.ok(isSafeReturnPath('/comecar?passo=contas'));
    assert.ok(isSafeReturnPath('/clientes/123e4567-e89b-42d3-a456-426614174000'));
  });

  it('recusa redirecionamento externo explícito', () => {
    assert.ok(!isSafeReturnPath('//evil.com'));
    assert.ok(!isSafeReturnPath('https://evil.com'));
    assert.ok(!isSafeReturnPath('http:evil.com'));
  });

  it('recusa barra invertida', () => {
    assert.ok(!isSafeReturnPath('/\\evil.com'));
    assert.ok(!isSafeReturnPath('\\\\evil.com'));
  });

  it('recusa caractere de controle que o navegador remove da URL', () => {
    assert.ok(!isSafeReturnPath('/\t/evil.com'));
    assert.ok(!isSafeReturnPath('/\n/evil.com'));
    assert.ok(!isSafeReturnPath('/\r/evil.com'));
    assert.ok(!isSafeReturnPath('/\u0000/evil.com'));
  });

  it('recusa string vazia e espaço', () => {
    assert.ok(!isSafeReturnPath(''));
    assert.ok(!isSafeReturnPath(' /comecar'));
  });
});

describe('sameOrigin', () => {
  it('aceita a mesma origem', () => {
    assert.ok(sameOrigin(new URL('http://localhost:3000/clientes'), 'http://localhost:3000'));
  });

  it('recusa host, porta ou esquema diferentes', () => {
    assert.ok(!sameOrigin(new URL('http://evil.com/x'), 'http://localhost:3000'));
    assert.ok(!sameOrigin(new URL('http://localhost:4000/x'), 'http://localhost:3000'));
    assert.ok(!sameOrigin(new URL('https://localhost:3000/x'), 'http://localhost:3000'));
  });

  it('recusa base inválida', () => {
    assert.ok(!sameOrigin(new URL('http://localhost:3000/x'), 'nao-e-url'));
  });
});

describe('tokenExchangeRequest', () => {
  it('envia code_verifier só onde há PKCE', () => {
    const google = tokenExchangeRequest(PROVIDERS.google, {
      code: 'c', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://x/cb', codeVerifier: 'v',
    });
    assert.equal(google.body.get('code_verifier'), 'v');

    const meta = tokenExchangeRequest(PROVIDERS.meta, {
      code: 'c', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://x/cb', codeVerifier: 'v',
    });
    assert.equal(meta.body.get('code_verifier'), null);
  });

  it('usa authorization_code', () => {
    const request = tokenExchangeRequest(PROVIDERS.google, {
      code: 'c', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://x/cb',
    });
    assert.equal(request.body.get('grant_type'), 'authorization_code');
  });
});

describe('longLivedExchangeUrl', () => {
  it('monta a troca de token curto por longo no Meta', () => {
    const url = new URL(
      longLivedExchangeUrl({ clientId: 'id', clientSecret: 'sec', shortLivedToken: 'curto' }),
    );
    assert.equal(url.searchParams.get('grant_type'), 'fb_exchange_token');
    assert.equal(url.searchParams.get('fb_exchange_token'), 'curto');
  });
});

describe('parseTokenResponse', () => {
  it('lê a resposta do Google com refresh token', () => {
    const granted = parseTokenResponse('google', {
      access_token: 'a', refresh_token: 'r', expires_in: 3599,
      scope: 'https://www.googleapis.com/auth/adwords',
    });
    assert.equal(granted?.refreshToken, 'r');
    assert.equal(granted?.expiresInSeconds, 3599);
  });

  it('aceita resposta sem refresh token', () => {
    const granted = parseTokenResponse('meta', { access_token: 'a' });
    assert.equal(granted?.refreshToken, null);
    assert.deepEqual(granted?.grantedScopes, PROVIDERS.meta.scopes);
  });

  it('recusa resposta sem access token', () => {
    assert.equal(parseTokenResponse('google', { error: 'invalid_grant' }), null);
    assert.equal(parseTokenResponse('google', null), null);
  });
});

describe('hasRequiredScopes', () => {
  it('exige adwords no Google', () => {
    assert.ok(!hasRequiredScopes('google', ['openid']));
    assert.ok(hasRequiredScopes('google', ['https://www.googleapis.com/auth/adwords']));
  });

  it('exige ao menos ads_read no Meta', () => {
    assert.ok(!hasRequiredScopes('meta', ['public_profile']));
    assert.ok(hasRequiredScopes('meta', ['ads_read']));
  });
});
