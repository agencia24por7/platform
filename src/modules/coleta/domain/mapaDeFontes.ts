import type { Platform } from '@/modules/connections/domain/connection';

export const Grao = {
  ContaDia: 'conta_dia',
  PropriedadeDia: 'propriedade_dia',
  SiteDia: 'site_dia',
  CanalDia: 'canal_dia',
  LocalDiaMetrica: 'local_dia_metrica',
  DatasetDiaEvento: 'dataset_dia_evento',
  Snapshot: 'snapshot',
} as const;
export type Grao = (typeof Grao)[keyof typeof Grao];

export const ModoColeta = {
  Amostra: 'amostra',
  Incremental: 'incremental',
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
  readonly janelaCompletaDias: number;
  readonly lookbackDias: number;
  readonly atrasoDias: number;
  readonly historicoMaximoDias: number;
  readonly janelaInicialDias: number;
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
    janelaCompletaDias: 28,
    lookbackDias: 7,
    atrasoDias: 1,
    historicoMaximoDias: 1095,
    janelaInicialDias: 7,
    rotulosEsperados: ['campaign.name'],
    preRequisitos: ['Google Ads API no nível Básico (15.000 operações/dia por developer token; ADR 0025 tem o custo da rotina).'],
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
    janelaCompletaDias: 28,
    lookbackDias: 7,
    atrasoDias: 1,
    historicoMaximoDias: 1095,
    janelaInicialDias: 7,
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
    janelaCompletaDias: 28,
    lookbackDias: 3,
    atrasoDias: 1,
    historicoMaximoDias: 1095,
    janelaInicialDias: 7,
    rotulosEsperados: ['propertyName'],
    preRequisitos: [],
  },
  searchconsole: {
    platform: 'searchconsole',
    ativaNoV1: true,
    motivoForaDoV1: null,
    tabelaFato: 'fato_search_console_diario',
    grao: Grao.SiteDia,
    endpoint: 'searchanalytics.query (dataState=final, 25k linhas/página)',
    dimensoes: ['date', 'device'],
    metricas: ['clicks', 'impressions', 'ctr', 'position'],
    janelaAmostraDias: 7,
    janelaCompletaDias: 28,
    lookbackDias: 3,
    atrasoDias: 3,
    historicoMaximoDias: 480,
    janelaInicialDias: 7,
    rotulosEsperados: ['siteUrl'],
    preRequisitos: ['dataState=final só fecha o dia com ~2-3 dias de atraso: a janela termina 3 dias antes de hoje (atrasoDias = 3).'],
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
    janelaCompletaDias: 28,
    lookbackDias: 3,
    atrasoDias: 1,
    historicoMaximoDias: 1095,
    janelaInicialDias: 7,
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
    janelaCompletaDias: 28,
    lookbackDias: 3,
    atrasoDias: 3,
    historicoMaximoDias: 540,
    janelaInicialDias: 7,
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
    janelaCompletaDias: 0,
    lookbackDias: 0,
    atrasoDias: 1,
    historicoMaximoDias: 0,
    janelaInicialDias: 1,
    rotulosEsperados: ['containerName'],
    preRequisitos: ['GTM não é série temporal: só alimenta gov_snapshot_fontes, nunca um fato diário.'],
  },
  pixel: {
    platform: 'pixel',
    ativaNoV1: true,
    motivoForaDoV1: null,
    tabelaFato: 'fato_meta_eventos_dataset',
    grao: Grao.DatasetDiaEvento,
    endpoint: '/{pixel_id}/stats?aggregation=event (baldes por hora, somados por dia em America/Sao_Paulo)',
    dimensoes: ['start_time', 'data.value', 'event_source'],
    metricas: ['data.count'],
    janelaAmostraDias: 7,
    janelaCompletaDias: 28,
    lookbackDias: 3,
    atrasoDias: 1,
    historicoMaximoDias: 28,
    janelaInicialDias: 7,
    rotulosEsperados: ['data.value'],
    preRequisitos: [
      'O conjunto de dados (pixel) precisa ser descoberto por uma conexão Meta Pixel e vinculado a um cliente.',
      'A API só guarda histórico curto de eventos: o backfill pede 28 dias, não 37 meses.',
      'origem: total (sem filtro), navegador (event_source=WEB_ONLY) e servidor (event_source=SERVER_ONLY). Para o total, use origem = total: navegador mais servidor não garante o total.',
    ],
  },
  leadads: {
    platform: 'leadads',
    ativaNoV1: true,
    motivoForaDoV1: null,
    tabelaFato: 'fato_meta_formularios',
    grao: Grao.Snapshot,
    endpoint: '/{page_id}?fields=access_token + /{page_id}/leadgen_forms (token da Página, só em memória)',
    dimensoes: ['id', 'name', 'status', 'created_time'],
    metricas: ['leads_count', 'expired_leads_count'],
    janelaAmostraDias: 0,
    janelaCompletaDias: 0,
    lookbackDias: 3,
    atrasoDias: 1,
    historicoMaximoDias: 28,
    janelaInicialDias: 28,
    rotulosEsperados: ['name'],
    preRequisitos: [
      'Snapshot diário de cada formulário: a janela é ignorada e a data é o dia da coleta em America/Sao_Paulo.',
      'Sem dado pessoal: nenhum lead nem resposta de formulário é lido; só contagens e metadados do formulário.',
      'O token da Página é pedido a cada execução e nunca sai do n8n; o coletor não guarda execução.',
      'Quem autorizou precisa ter a tarefa ADVERTISE, MANAGE ou MANAGE_LEADS na Página.',
    ],
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
    janelaCompletaDias: 0,
    lookbackDias: 0,
    atrasoDias: 1,
    historicoMaximoDias: 0,
    janelaInicialDias: 1,
    rotulosEsperados: [],
    preRequisitos: [],
  },
  rdstation: {
    platform: 'rdstation',
    ativaNoV1: true,
    motivoForaDoV1: null,
    tabelaFato: 'fato_rd_negociacoes',
    grao: Grao.Snapshot,
    endpoint: 'CRM v1: /deal_pipelines + /deals?deal_pipeline_id (200 por página, next_page)',
    dimensoes: ['deal_pipeline.id', 'deal_pipeline.name', 'deal_stage.id', 'deal_stage.name', 'deal_stage.order', 'deal_source.name', 'campaign.name'],
    metricas: ['win', 'hold', 'amount_total', 'amount_montly', 'amount_unique', 'created_at', 'updated_at', 'closed_at'],
    janelaAmostraDias: 0,
    janelaCompletaDias: 0,
    lookbackDias: 0,
    atrasoDias: 1,
    historicoMaximoDias: 0,
    janelaInicialDias: 1,
    rotulosEsperados: ['deal_pipeline.name', 'deal_stage.name'],
    preRequisitos: [
      'Snapshot diário do estado de cada negociação: a janela é ignorada e a data é o dia da coleta em America/Sao_Paulo.',
      'Sem dado pessoal: nome da negociação, contatos, organização, responsável, anotações e campos personalizados nunca saem do n8n.',
      'Chave guardada como httpQueryAuth (token na query). Chave guardada antes disso precisa ser guardada de novo para ganhar coletor.',
    ],
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
    janelaCompletaDias: 0,
    lookbackDias: 0,
    atrasoDias: 1,
    historicoMaximoDias: 0,
    janelaInicialDias: 1,
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
    janelaCompletaDias: 0,
    lookbackDias: 0,
    atrasoDias: 1,
    historicoMaximoDias: 0,
    janelaInicialDias: 1,
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

const FUSO_DO_DIA_DA_COLETA = 'America/Sao_Paulo';

export function janelaAteOntem(platform: Platform, modo: ModoColeta, agora: Date = new Date()): { readonly start: string; readonly end: string } {
  const dias = janelaDias(platform, modo) || 1;
  const [ano, mes, dia] = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_DO_DIA_DA_COLETA, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(agora).split('-').map(Number) as [number, number, number];
  const fim = new Date(Date.UTC(ano, mes - 1, dia - 1));
  const inicio = new Date(fim);
  inicio.setUTCDate(inicio.getUTCDate() - (dias - 1));

  const isoDate = (data: Date): string => data.toISOString().slice(0, 10);
  return { start: isoDate(inicio), end: isoDate(fim) };
}
