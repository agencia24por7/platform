import type { Platform } from '@/modules/connections/domain/connection';

export type OauthProvider = {
  readonly platform: PlataformaOauth;
  readonly label: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scopes: readonly string[];
  readonly usesPkce: boolean;
  readonly usesConfigId: boolean;
};

export const PLATAFORMAS_OAUTH = [
  'google',
  'meta',
  'rdstation',
  'ga4',
  'gtm',
  'pixel',
  'searchconsole',
  'youtube',
  'gbp',
] as const;
export type PlataformaOauth = (typeof PLATAFORMAS_OAUTH)[number];

export const FAMILIA_GOOGLE = [
  'google',
  'ga4',
  'gtm',
  'searchconsole',
  'youtube',
  'gbp',
] as const satisfies readonly PlataformaOauth[];
export type PlataformaGoogle = (typeof FAMILIA_GOOGLE)[number];

export function usaOauthDoGoogle(platform: PlataformaOauth): platform is PlataformaGoogle {
  return (FAMILIA_GOOGLE as readonly string[]).includes(platform);
}

export const FAMILIA_META = ['meta', 'pixel'] as const satisfies readonly PlataformaOauth[];
export type PlataformaMeta = (typeof FAMILIA_META)[number];

export function usaOauthDaMeta(platform: PlataformaOauth): platform is PlataformaMeta {
  return (FAMILIA_META as readonly string[]).includes(platform);
}

export function falaOauth(platform: Platform): platform is PlataformaOauth {
  return (PLATAFORMAS_OAUTH as readonly string[]).includes(platform);
}

const ESCOPOS_DE_IDENTIDADE = ['openid', 'https://www.googleapis.com/auth/userinfo.email'] as const;

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
  ga4: {
    platform: 'ga4',
    label: 'Google Analytics',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/analytics.readonly', ...ESCOPOS_DE_IDENTIDADE],
    usesPkce: true,
    usesConfigId: false,
  },
  gtm: {
    platform: 'gtm',
    label: 'Google Tag Manager',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/tagmanager.readonly', ...ESCOPOS_DE_IDENTIDADE],
    usesPkce: true,
    usesConfigId: false,
  },
  pixel: {
    platform: 'pixel',
    label: 'Meta Pixel',
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scopes: ['ads_read', 'business_management'],
    usesPkce: false,
    usesConfigId: true,
  },
  searchconsole: {
    platform: 'searchconsole',
    label: 'Search Console',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly', ...ESCOPOS_DE_IDENTIDADE],
    usesPkce: true,
    usesConfigId: false,
  },
  youtube: {
    platform: 'youtube',
    label: 'YouTube',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/yt-analytics.readonly',
      'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
      'https://www.googleapis.com/auth/youtube.readonly',
      ...ESCOPOS_DE_IDENTIDADE,
    ],
    usesPkce: true,
    usesConfigId: false,
  },
  gbp: {
    platform: 'gbp',
    label: 'Perfil da Empresa no Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/business.manage', ...ESCOPOS_DE_IDENTIDADE],
    usesPkce: true,
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
  const exigeConfigId = falaOauth(platform) && PROVIDERS[platform].usesConfigId;
  return exigeConfigId ? Boolean(credentials.configId) : true;
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

  if (usaOauthDoGoogle(provider.platform)) {
    url.searchParams.set('scope', provider.scopes.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
  }

  if (provider.platform === 'google') {
    url.searchParams.set('include_granted_scopes', 'true');
  }

  if (usaOauthDaMeta(provider.platform) && input.configId) {
    url.searchParams.set('config_id', input.configId);
  }

  if (provider.usesPkce && input.codeChallenge) {
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return url.toString();
}


export type FormatoDoCorpo = 'form' | 'json';

export type TokenExchangeRequest = {
  readonly url: string;
  readonly body: string;
  readonly contentType: string;
};

const FORMATO_DO_CORPO: Record<PlataformaOauth, FormatoDoCorpo> = {
  google: 'form',
  ga4: 'form',
  meta: 'form',
  rdstation: 'json',
  gtm: 'form',
  pixel: 'form',
  searchconsole: 'form',
  youtube: 'form',
  gbp: 'form',
};

function corpoNoFormato(campos: Record<string, string>, formato: FormatoDoCorpo): TokenExchangeRequest['body'] {
  return formato === 'json'
    ? JSON.stringify(campos)
    : new URLSearchParams(campos).toString();
}

const TIPO_DO_CORPO: Record<FormatoDoCorpo, string> = {
  form: 'application/x-www-form-urlencoded',
  json: 'application/json',
};

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
  const formato = FORMATO_DO_CORPO[provider.platform];

  const campos: Record<string, string> =
    formato === 'json'
      ? {
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code: input.code,
        }
      : {
          code: input.code,
          client_id: input.clientId,
          client_secret: input.clientSecret,
          redirect_uri: input.redirectUri,
          grant_type: 'authorization_code',
        };

  if (formato === 'form' && provider.usesPkce && input.codeVerifier) {
    campos['code_verifier'] = input.codeVerifier;
  }

  return {
    url: provider.tokenUrl,
    body: corpoNoFormato(campos, formato),
    contentType: TIPO_DO_CORPO[formato],
  };
}

export function longLivedExchangeRequest(input: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly shortLivedToken: string;
}): TokenExchangeRequest {
  return {
    url: PROVIDERS.meta.tokenUrl,
    body: new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      fb_exchange_token: input.shortLivedToken,
    }).toString(),
    contentType: TIPO_DO_CORPO.form,
  };
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
  ga4: PROVIDERS.ga4.scopes,
  gtm: PROVIDERS.gtm.scopes,
  pixel: ['ads_read'],
  searchconsole: PROVIDERS.searchconsole.scopes,
  youtube: ['https://www.googleapis.com/auth/yt-analytics.readonly'],
  gbp: PROVIDERS.gbp.scopes,
};

export function hasRequiredScopes(platform: PlataformaOauth, granted: readonly string[]): boolean {
  return ESCOPOS_EXIGIDOS[platform].every((scope) => granted.includes(scope));
}

const ADWORDS = 'https://www.googleapis.com/auth/adwords';

const ESCOPOS_PROIBIDOS: Partial<Record<PlataformaOauth, readonly string[]>> = {
  ga4: [
    ADWORDS,
    'https://www.googleapis.com/auth/analytics.edit',
    'https://www.googleapis.com/auth/analytics.manage.users',
  ],
  gtm: [
    ADWORDS,
    'https://www.googleapis.com/auth/tagmanager.edit.containers',
    'https://www.googleapis.com/auth/tagmanager.publish',
    'https://www.googleapis.com/auth/tagmanager.delete.containers',
  ],
  searchconsole: [ADWORDS, 'https://www.googleapis.com/auth/webmasters'],
  youtube: [ADWORDS, 'https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.force-ssl'],
  gbp: [ADWORDS],
};

export function escopoExcedente(
  platform: PlataformaOauth,
  granted: readonly string[],
): readonly string[] {
  const proibidos = ESCOPOS_PROIBIDOS[platform];
  if (!proibidos) return [];
  return granted.filter((scope) => proibidos.includes(scope));
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
