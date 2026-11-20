import type { Platform } from '@/modules/connections/domain/connection';

export const Grao = {
  ContaDia: 'conta_dia',
  PropriedadeDia: 'propriedade_dia',
  SiteDia: 'site_dia',
  CanalDia: 'canal_dia',
  LocalDiaMetrica: 'local_dia_metrica',
  Snapshot: 'snapshot',
} as const;
export type Grao = (typeof Grao)[keyof typeof Grao];

export const ModoColeta = {
  Amostra: 'amostra',
  Completa: 'completa',
} as const;
export type ModoColeta = (typeof ModoColeta)[keyof typeof ModoColeta];

export type FonteDeColeta = {
  readonly platform: Platform;
  readonly ativaNoV1: boolean;
  readonly motivoForaDoV1: string | null;
  readonly tabelaFato: string | null;
  readonly grao: Grao;
  readonly endpoint: string;
  readonly dimensoes: readonly string[];
  readonly metricas: readonly string[];
  readonly janelaAmostraDias: number;
  readonly limiteLinhasAmostra: number | null;
  readonly janelaCompletaDias: number;
  readonly rotulosEsperados: readonly string[];
  readonly preRequisitos: readonly string[];
};

export const MAPA_DE_FONTES: Record<Platform, FonteDeColeta> = {
  google: {
    platform: 'google',
    ativaNoV1: true,
    motivoForaDoV1: null,
    tabelaFato: 'fato_ads_diario',
    grao: Grao.ContaDia,
    endpoint: 'GoogleAdsService.SearchStream (GAQL, segments.date)',
    dimensoes: ['campaign.id', 'campaign.name', 'segments.date'],
    metricas: ['metrics.cost_micros', 'metrics.impressions', 'metrics.clicks', 'metrics.conversions', 'metrics.conversions_value'],
    janelaAmostraDias: 7,
    limiteLinhasAmostra: 500,
    janelaCompletaDias: 28,
    rotulosEsperados: ['campaign.name'],
    preRequisitos: ['Nível de acesso do Google Ads API habilitado para contas de produção (hoje: Exploração, 2.880 op/dia)'],
  },
  meta: {
    platform: 'meta',
    ativaNoV1: true,
    motivoForaDoV1: null,
    tabelaFato: 'fato_ads_diario',
    grao: Grao.ContaDia,
    endpoint: '/{ad_account_id}/insights?level=campaign&time_increment=1',
    dimensoes: ['campaign_id', 'campaign_name', 'date_start'],
    metricas: ['spend', 'impressions', 'clicks', 'actions', 'action_values'],
    janelaAmostraDias: 7,
    limiteLinhasAmostra: 500,
    janelaCompletaDias: 28,
    rotulosEsperados: ['campaign_name'],
    preRequisitos: [],
  },
  ga4: {
    platform: 'ga4',
    ativaNoV1: true,
    motivoForaDoV1: null,
    tabelaFato: 'fato_ga4_diario',
    grao: Grao.PropriedadeDia,
    endpoint: 'properties.batchRunReports (5 relatórios = 1 operação de cota) + properties.getMetadata',
    dimensoes: ['date', 'sessionDefaultChannelGroup'],
    metricas: ['sessions', 'totalUsers', 'newUsers', 'keyEvents', 'totalRevenue'],
    janelaAmostraDias: 7,
    limiteLinhasAmostra: 500,
    janelaCompletaDias: 28,
    rotulosEsperados: ['propertyName'],
    preRequisitos: [],
  },
  searchconsole: {
    platform: 'searchconsole',
    ativaNoV1: true,
    motivoForaDoV1: null,
    tabelaFato: 'fato_search_console_diario',
    grao: Grao.SiteDia,
    endpoint: 'searchanalytics.query (dataState=all, 25k linhas/página)',
    dimensoes: ['date', 'device'],
    metricas: ['clicks', 'impressions', 'ctr', 'position'],
    janelaAmostraDias: 7,
    limiteLinhasAmostra: 500,
    janelaCompletaDias: 28,
    rotulosEsperados: ['siteUrl'],
    preRequisitos: ['Dados têm ~2 dias de atraso: a janela completa nunca inclui os últimos 2 dias.'],
  },
  youtube: {
    platform: 'youtube',
    ativaNoV1: true,
    motivoForaDoV1: null,
    tabelaFato: 'fato_youtube_diario',
    grao: Grao.CanalDia,
    endpoint: 'reports.query (dimensions=day, inclui receita)',
    dimensoes: ['day'],
    metricas: ['views', 'estimatedMinutesWatched', 'subscribersGained', 'subscribersLost', 'estimatedRevenue'],
    janelaAmostraDias: 7,
    limiteLinhasAmostra: 500,
    janelaCompletaDias: 28,
    rotulosEsperados: ['channelName'],
    preRequisitos: [],
  },
  gbp: {
    platform: 'gbp',
    ativaNoV1: true,
    motivoForaDoV1: null,
    tabelaFato: 'fato_gbp_diario',
    grao: Grao.LocalDiaMetrica,
    endpoint: 'locations.fetchMultiDailyMetricsTimeSeries',
    dimensoes: ['date', 'metric'],
    metricas: ['value'],
    janelaAmostraDias: 7,
    limiteLinhasAmostra: 500,
    janelaCompletaDias: 28,
    rotulosEsperados: ['locationName'],
    preRequisitos: ['businessprofileperformance.googleapis.com habilitada no projeto (✅ confirmado na Fase 0)'],
  },
  gtm: {
    platform: 'gtm',
    ativaNoV1: true,
    motivoForaDoV1: null,
    tabelaFato: null,
    grao: Grao.Snapshot,
    endpoint: 'accounts.containers.versions.live',
    dimensoes: [],
    metricas: [],
    janelaAmostraDias: 0,
    limiteLinhasAmostra: null,
    janelaCompletaDias: 0,
    rotulosEsperados: ['containerName'],
    preRequisitos: ['GTM não é série temporal: só alimenta gov_snapshot_fontes, nunca um fato diário.'],
  },
  pixel: {
    platform: 'pixel',
    ativaNoV1: false,
    motivoForaDoV1: 'Não existe descoberta de pixels hoje (nenhum fluxo lista os pixels de uma conta Meta).',
    tabelaFato: null,
    grao: Grao.Snapshot,
    endpoint: '',
    dimensoes: [],
    metricas: [],
    janelaAmostraDias: 0,
    limiteLinhasAmostra: null,
    janelaCompletaDias: 0,
    rotulosEsperados: [],
    preRequisitos: [],
  },
  whatsapp: {
    platform: 'whatsapp',
    ativaNoV1: false,
    motivoForaDoV1: 'Fluxo é webhook-driven (eventos chegam, não são puxados); não cabe num orquestrador de coleta por janela.',
    tabelaFato: null,
    grao: Grao.Snapshot,
    endpoint: '',
    dimensoes: [],
    metricas: [],
    janelaAmostraDias: 0,
    limiteLinhasAmostra: null,
    janelaCompletaDias: 0,
    rotulosEsperados: [],
    preRequisitos: [],
  },
  rdstation: {
    platform: 'rdstation',
    ativaNoV1: false,
    motivoForaDoV1: 'Conexão única por organização, sem recorte de cliente — a camada de coleta exige client_id por linha.',
    tabelaFato: null,
    grao: Grao.Snapshot,
    endpoint: '',
    dimensoes: [],
    metricas: [],
    janelaAmostraDias: 0,
    limiteLinhasAmostra: null,
    janelaCompletaDias: 0,
    rotulosEsperados: [],
    preRequisitos: [],
  },
  apify: {
    platform: 'apify',
    ativaNoV1: false,
    motivoForaDoV1: 'Conexão única por organização, sem recorte de cliente — a camada de coleta exige client_id por linha.',
    tabelaFato: null,
    grao: Grao.Snapshot,
    endpoint: '',
    dimensoes: [],
    metricas: [],
    janelaAmostraDias: 0,
    limiteLinhasAmostra: null,
    janelaCompletaDias: 0,
    rotulosEsperados: [],
    preRequisitos: [],
  },
  zapi: {
    platform: 'zapi',
    ativaNoV1: false,
    motivoForaDoV1: 'Conexão única por organização, sem recorte de cliente — a camada de coleta exige client_id por linha.',
    tabelaFato: null,
    grao: Grao.Snapshot,
    endpoint: '',
    dimensoes: [],
    metricas: [],
    janelaAmostraDias: 0,
    limiteLinhasAmostra: null,
    janelaCompletaDias: 0,
    rotulosEsperados: [],
    preRequisitos: [],
  },
};

export function fontesAtivasNoV1(): readonly FonteDeColeta[] {
  return (Object.values(MAPA_DE_FONTES) as FonteDeColeta[]).filter((fonte) => fonte.ativaNoV1);
}

export function plataformasColetaveis(): readonly Platform[] {
  return fontesAtivasNoV1().map((fonte) => fonte.platform);
}

export function fonteDe(platform: Platform): FonteDeColeta {
  return MAPA_DE_FONTES[platform];
}

export function janelaDias(platform: Platform, modo: ModoColeta): number {
  const fonte = fonteDe(platform);
  return modo === ModoColeta.Amostra ? fonte.janelaAmostraDias : fonte.janelaCompletaDias;
}

export function limiteLinhas(platform: Platform, modo: ModoColeta): number | null {
  return modo === ModoColeta.Amostra ? fonteDe(platform).limiteLinhasAmostra : null;
}

export function janelaAteOntem(platform: Platform, modo: ModoColeta, hoje: Date = new Date()): { readonly start: string; readonly end: string } {
  const dias = janelaDias(platform, modo) || 1;
  const fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - 1));
  const inicio = new Date(fim);
  inicio.setUTCDate(inicio.getUTCDate() - (dias - 1));

  const isoDate = (data: Date): string => data.toISOString().slice(0, 10);
  return { start: isoDate(inicio), end: isoDate(fim) };
}
