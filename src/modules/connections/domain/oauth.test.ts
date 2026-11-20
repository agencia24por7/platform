import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PROVIDERS,
  authorizeUrlFor,
  hasRequiredScopes,
  isConfigured,
  isSafeReturnPath,
  longLivedExchangeRequest,
  parseTokenResponse,
  requestCameFromBase,
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
  const campos = (corpo: string) => new URLSearchParams(corpo);

  it('envia code_verifier só onde há PKCE', () => {
    const google = tokenExchangeRequest(PROVIDERS.google, {
      code: 'c', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://x/cb', codeVerifier: 'v',
    });
    assert.equal(campos(google.body).get('code_verifier'), 'v');

    const meta = tokenExchangeRequest(PROVIDERS.meta, {
      code: 'c', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://x/cb', codeVerifier: 'v',
    });
    assert.equal(campos(meta.body).get('code_verifier'), null);
  });

  it('usa authorization_code', () => {
    const request = tokenExchangeRequest(PROVIDERS.google, {
      code: 'c', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://x/cb',
    });
    assert.equal(campos(request.body).get('grant_type'), 'authorization_code');
    assert.equal(request.contentType, 'application/x-www-form-urlencoded');
  });

  it('o RD Station recebe JSON, como a API dele pede', () => {
    const request = tokenExchangeRequest(PROVIDERS.rdstation, {
      code: 'c', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://x/cb',
    });
    assert.equal(request.contentType, 'application/json');
    assert.deepEqual(JSON.parse(request.body), { client_id: 'id', client_secret: 'sec', code: 'c' });
  });

  it('nenhum segredo vai na URL da troca', () => {
    for (const provider of [PROVIDERS.google, PROVIDERS.meta, PROVIDERS.ga4, PROVIDERS.rdstation]) {
      const request = tokenExchangeRequest(provider, {
        code: 'c', clientId: 'id', clientSecret: 'sec-que-nao-pode-vazar', redirectUri: 'http://x/cb',
      });
      assert.ok(!request.url.includes('sec-que-nao-pode-vazar'), provider.platform);
      assert.ok(!request.url.includes('?'), `${provider.platform} não pode levar query na troca`);
    }
  });
});

describe('longLivedExchangeRequest', () => {
  it('troca token curto por longo sem pôr segredo na URL', () => {
    const troca = longLivedExchangeRequest({
      clientId: 'id', clientSecret: 'sec-que-nao-pode-vazar', shortLivedToken: 'curto',
    });

    assert.ok(!troca.url.includes('sec-que-nao-pode-vazar'));
    assert.ok(!troca.url.includes('curto'));
    assert.ok(!troca.url.includes('?'));

    const corpo = new URLSearchParams(troca.body);
    assert.equal(corpo.get('grant_type'), 'fb_exchange_token');
    assert.equal(corpo.get('fb_exchange_token'), 'curto');
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

describe('requestCameFromBase', () => {
  const base = 'https://platform.agencia24por7.com';

  it('aceita o que o proxy encaminhou, mesmo o Next vendo localhost', () => {
    assert.ok(
      requestCameFromBase(
        { host: 'platform.agencia24por7.com', forwardedProtocol: 'https' },
        base,
      ),
    );
  });

  it('recusa quando o proxy nao declara https', () => {
    assert.ok(!requestCameFromBase({ host: 'platform.agencia24por7.com' }, base));
    assert.ok(
      !requestCameFromBase(
        { host: 'platform.agencia24por7.com', forwardedProtocol: 'http' },
        base,
      ),
    );
  });

  it('recusa outro host mesmo com https declarado', () => {
    assert.ok(!requestCameFromBase({ host: 'evil.com', forwardedProtocol: 'https' }, base));
    assert.ok(!requestCameFromBase({ host: null, forwardedProtocol: 'https' }, base));
  });

  it('usa o primeiro valor quando a cadeia tem varios', () => {
    assert.ok(
      requestCameFromBase(
        {
          host: 'app:3000',
          forwardedHost: 'platform.agencia24por7.com, interno',
          forwardedProtocol: 'https, http',
        },
        base,
      ),
    );
  });

  it('nao se confunde com caixa alta no host', () => {
    assert.ok(
      requestCameFromBase(
        { host: 'Platform.Agencia24Por7.com', forwardedProtocol: 'HTTPS' },
        base,
      ),
    );
  });

  it('em desenvolvimento, sem proxy, http e o esperado', () => {
    assert.ok(requestCameFromBase({ host: 'localhost:3000' }, 'http://localhost:3000'));
    assert.ok(!requestCameFromBase({ host: 'localhost:4000' }, 'http://localhost:3000'));
  });
});

describe('isSafeReturnPath com segmentos de ponto', () => {
  it('recusa caminho que normaliza para //outro-dominio', () => {
    for (const caminho of ['/a/..//evil.example', '/%2e%2e//evil.example', '/./..//evil.example/x']) {
      assert.equal(isSafeReturnPath(caminho), false, caminho);
    }
    assert.equal(isSafeReturnPath('/integracoes/conector/meta?aviso=ok'), true);
  });
});

