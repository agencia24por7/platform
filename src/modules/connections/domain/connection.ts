export const Platform = {
  Meta: 'meta',
  Google: 'google',
  RdStation: 'rdstation',
  Apify: 'apify',
  Ga4: 'ga4',
  ZApi: 'zapi',
  Gtm: 'gtm',
  Pixel: 'pixel',
  SearchConsole: 'searchconsole',
  Youtube: 'youtube',
  Gbp: 'gbp',
} as const;
export type Platform = (typeof Platform)[keyof typeof Platform];

export const PLATAFORMAS_DE_ANUNCIO = ['google', 'meta'] as const;
export type PlataformaDeAnuncio = (typeof PLATAFORMAS_DE_ANUNCIO)[number];

export function veiculaAnuncio(platform: Platform): platform is PlataformaDeAnuncio {
  return (PLATAFORMAS_DE_ANUNCIO as readonly string[]).includes(platform);
}

export const ROTULO_DA_PLATAFORMA: Record<Platform, string> = {
  google: 'Google Ads',
  meta: 'Meta Ads',
  rdstation: 'RD Station CRM',
  apify: 'Apify',
  ga4: 'Google Analytics',
  zapi: 'Z-API',
  gtm: 'Google Tag Manager',
  pixel: 'Meta Pixel',
  searchconsole: 'Search Console',
  youtube: 'YouTube',
  gbp: 'Google Minha Empresa',
};

export const MARCA_DA_PLATAFORMA: Record<Platform, string | null> = {
  google: '/marcas/google-ads.png',
  meta: '/marcas/meta.png',
  rdstation: '/marcas/rdstation.png',
  apify: '/marcas/apify.png',
  ga4: null,
  zapi: '/marcas/zapi.png',
  gtm: '/marcas/gtm.png',
  pixel: '/marcas/meta.png',
  searchconsole: '/marcas/searchconsole.png',
  youtube: '/marcas/youtube.png',
  gbp: '/marcas/gbp.png',
};

export const PARA_QUE_SERVE: Record<Platform, string> = {
  google: 'Contas de anúncio, campanhas e custo. Alcança contas de terceiros pela administradora.',
  meta: 'Contas de anúncio do Business Manager. Cada cliente autoriza com a conta dele.',
  rdstation: 'Negociações, contatos e funil de vendas do CRM. Entra como conexão; ainda não alimenta relatório.',
  apify: 'Coleta de dados públicos por chave de API. Entra como conexão; ainda não alimenta relatório.',
  ga4: 'Sessões, origem de tráfego e conversões do site. Entra como conexão; ainda não alimenta relatório.',
  zapi: 'Mensagens de WhatsApp por chave de API. Entra como conexão; ainda não alimenta relatório.',
  gtm: 'Tags e gatilhos dos contêineres do site, só leitura. Audita o que dispara em cada página.',
  pixel: 'Eventos do Pixel e das Conversions API da Meta. Mede o que o site devolve para os anúncios.',
  searchconsole: 'Consultas, cliques e impressões da busca orgânica dos sites verificados.',
  youtube: 'Relatórios do canal no YouTube Analytics, inclusive receita, só leitura.',
  gbp: 'Visualizações, buscas e ações no Google Minha Empresa. A API do Google só oferece escopo de gestão.',
};

export const GrantType = {
  Mcc: 'mcc',
  BmPartner: 'bm_partner',
  SystemUser: 'system_user',
  OauthUser: 'oauth_user',
  ApiKey: 'api_key',
} as const;
export type GrantType = (typeof GrantType)[keyof typeof GrantType];

export type ConnectionStatus = 'active' | 'expiring' | 'degraded' | 'revoked' | 'reauth_pending';

export type Connection = {
  readonly id: string;
  readonly organizationId: string;
  readonly platform: Platform;
  readonly grantType: GrantType;
  readonly label: string;
  readonly externalId: string;
  readonly accountEmail: string | null;
  readonly scopes: readonly string[];
  readonly credentialRef: string;
  readonly status: ConnectionStatus;
  readonly expiresAt: Date | null;
  readonly authorizedAt: Date;
};

export type NewConnection = Omit<Connection, 'id' | 'status' | 'authorizedAt'> & {
  readonly expiresAt: Date | null;
  readonly status?: Connection['status'];
};

export const CREDENCIAL_SEM_COFRE = 'pendente:cofre-indisponivel';

export function readinessOf(connection: Pick<Connection, 'status' | 'credentialRef'>): {
  readonly collectable: boolean;
  readonly reason: string | null;
} {
  if (connection.credentialRef.startsWith('pendente:')) {
    return { collectable: false, reason: 'A credencial não foi guardada: o cofre do n8n não respondeu.' };
  }
  if (connection.status === 'revoked') {
    return { collectable: false, reason: 'Autorização revogada na plataforma.' };
  }
  if (connection.status === 'reauth_pending') {
    return { collectable: false, reason: 'A plataforma pediu nova autorização.' };
  }
  if (connection.status === 'degraded') {
    return { collectable: false, reason: 'Autorização incompleta. Reconecte para coletar.' };
  }
  return { collectable: true, reason: null };
}

const REQUIRED_SCOPES: Record<Platform, readonly string[]> = {
  google: ['adwords'],
  meta: ['ads_read'],
  rdstation: [],
  apify: [],
  ga4: ['https://www.googleapis.com/auth/analytics.readonly'],
  zapi: [],
  gtm: ['https://www.googleapis.com/auth/tagmanager.readonly'],
  pixel: ['ads_read'],
  searchconsole: ['https://www.googleapis.com/auth/webmasters.readonly'],
  youtube: ['https://www.googleapis.com/auth/yt-analytics.readonly'],
  gbp: ['https://www.googleapis.com/auth/business.manage'],
};

export function missingScopes(platform: Platform, scopes: readonly string[]): readonly string[] {
  return REQUIRED_SCOPES[platform].filter((scope) => !scopes.includes(scope));
}

const GRANTS_BY_PLATFORM: Record<Platform, readonly GrantType[]> = {
  google: ['mcc', 'oauth_user'],
  meta: ['bm_partner', 'system_user', 'oauth_user'],
  rdstation: ['oauth_user'],
  apify: ['api_key'],
  ga4: ['oauth_user'],
  zapi: ['api_key'],
  gtm: ['oauth_user'],
  pixel: ['oauth_user'],
  searchconsole: ['oauth_user'],
  youtube: ['oauth_user'],
  gbp: ['oauth_user'],
};

export function grantTypesFor(platform: Platform): readonly GrantType[] {
  return GRANTS_BY_PLATFORM[platform];
}
