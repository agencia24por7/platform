import type { Platform } from '@/modules/connections/domain/connection';

export type OauthProvider = {
  readonly platform: Platform;
  readonly label: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scopes: readonly string[];
  readonly usesPkce: boolean;
  readonly usesConfigId: boolean;
};

export const PLATAFORMAS_OAUTH = ['google', 'meta', 'rdstation'] as const;
export type PlataformaOauth = (typeof PLATAFORMAS_OAUTH)[number];

export function falaOauth(platform: Platform): platform is PlataformaOauth {
  return (PLATAFORMAS_OAUTH as readonly string[]).includes(platform);
}

export const PROVIDERS: Readonly<Record<PlataformaOauth, OauthProvider>> = {
  google: {
    platform: 'google',
    label: 'Google Ads',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/adwords'],
    usesPkce: true,
    usesConfigId: false,
  },
  meta: {
    platform: 'meta',
    label: 'Meta Ads',
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scopes: ['ads_read', 'ads_management', 'business_management', 'leads_retrieval'],
    usesPkce: false,
    usesConfigId: true,
  },
  rdstation: {
    platform: 'rdstation',
    label: 'RD Station',
    authorizeUrl: 'https://api.rd.services/auth/dialog',
    tokenUrl: 'https://api.rd.services/auth/token',
    scopes: [],
    usesPkce: false,
    usesConfigId: false,
  },
};

export type ProviderCredentials = {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly configId?: string;
};

export function isConfigured(credentials: ProviderCredentials, platform: Platform): boolean {
  if (!credentials.clientId || !credentials.clientSecret) return false;
  return platform === 'meta' ? Boolean(credentials.configId) : true;
}

export function authorizeUrlFor(
  provider: OauthProvider,
  input: {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly state: string;
    readonly codeChallenge?: string;
    readonly configId?: string;
  },
): string {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);

  if (provider.platform !== 'rdstation') {
    url.searchParams.set('response_type', 'code');
  }

  if (provider.platform === 'google') {
    url.searchParams.set('scope', provider.scopes.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
  }

  if (provider.platform === 'meta' && input.configId) {
    url.searchParams.set('config_id', input.configId);
  }

  if (provider.usesPkce && input.codeChallenge) {
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return url.toString();
}


export type TokenExchangeRequest = { readonly url: string; readonly body: URLSearchParams };

export function tokenExchangeRequest(
  provider: OauthProvider,
  input: {
    readonly code: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly redirectUri: string;
    readonly codeVerifier?: string;
  },
): TokenExchangeRequest {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  });

  if (provider.usesPkce && input.codeVerifier) body.set('code_verifier', input.codeVerifier);

  return { url: provider.tokenUrl, body };
}

export function longLivedExchangeUrl(input: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly shortLivedToken: string;
}): string {
  const url = new URL(PROVIDERS.meta.tokenUrl);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('client_secret', input.clientSecret);
  url.searchParams.set('fb_exchange_token', input.shortLivedToken);
  return url.toString();
}

export type GrantedToken = {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresInSeconds: number | null;
  readonly grantedScopes: readonly string[];
};

export function parseTokenResponse(platform: PlataformaOauth, payload: unknown): GrantedToken | null {
  if (payload === null || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;

  const accessToken = typeof data.access_token === 'string' ? data.access_token : null;
  if (!accessToken) return null;

  return {
    accessToken,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
    expiresInSeconds: typeof data.expires_in === 'number' ? data.expires_in : null,
    grantedScopes:
      typeof data.scope === 'string' && data.scope.length > 0
        ? data.scope.split(' ').filter(Boolean)
        : PROVIDERS[platform].scopes,
  };
}

const ESCOPOS_EXIGIDOS: Record<PlataformaOauth, readonly string[]> = {
  google: PROVIDERS.google.scopes,
  meta: ['ads_read'],
  rdstation: [],
};

export function hasRequiredScopes(platform: PlataformaOauth, granted: readonly string[]): boolean {
  return ESCOPOS_EXIGIDOS[platform].every((scope) => granted.includes(scope));
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const INTERNAL_ORIGIN = 'https://interno.invalid';

export function isSafeReturnPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (path.includes('\\') || CONTROL_CHARACTERS.test(path)) return false;

  try {
    return new URL(path, INTERNAL_ORIGIN).origin === INTERNAL_ORIGIN;
  } catch {
    return false;
  }
}

export function sameOrigin(candidate: URL, base: string): boolean {
  try {
    return candidate.origin === new URL(base).origin;
  } catch {
    return false;
  }
}

const primeiro = (valor: string | null | undefined): string | null =>
  valor ? (valor.split(',')[0]?.trim() ?? null) : null;

export type PublicRequestOrigin = {
  readonly host: string | null;
  readonly forwardedHost?: string | null;
  readonly forwardedProtocol?: string | null;
};

export function requestCameFromBase(origin: PublicRequestOrigin, base: string): boolean {
  try {
    const esperado = new URL(base);

    const host = primeiro(origin.forwardedHost) ?? primeiro(origin.host);
    if (!host || host.toLowerCase() !== esperado.host.toLowerCase()) return false;

    const protocolo = primeiro(origin.forwardedProtocol);
    if (!protocolo) return esperado.protocol === 'http:';

    return `${protocolo.toLowerCase()}:` === esperado.protocol;
  } catch {
    return false;
  }
}
