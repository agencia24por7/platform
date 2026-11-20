import type { PlataformaDeAnuncio } from '@/modules/connections/domain/connection';
import { agora, type ConfiguracaoFato } from '@/modules/coleta/infrastructure/tabelas/tipos';

const TIPOS_ADS = {
  organization_id: 'STRING', platform: 'STRING', ad_account_id: 'STRING',
  external_campaign_id: 'STRING', campaign_name: 'STRING', data_dia: 'DATE', investimento: 'NUMERIC',
  impressoes: 'INT64', cliques: 'INT64', conversoes: 'NUMERIC', receita: 'NUMERIC', moeda: 'STRING',
  versao_api: 'STRING', execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
} as const;

export function fatoAdsDiario(platform: PlataformaDeAnuncio): ConfiguracaoFato {
  return {
    tipo: 'fato',
    staging: 'stg_ads_diario',
    fato: 'fato_ads_diario',
    chave: ['organization_id', 'ad_account_id', 'external_campaign_id', 'data_dia'],
    colunas: [
      'organization_id', 'platform', 'ad_account_id', 'external_campaign_id', 'campaign_name',
      'data_dia', 'investimento', 'impressoes', 'cliques', 'conversoes', 'receita', 'moeda', 'versao_api',
      'execucao_id', 'inserido_em',
    ],
    tipos: TIPOS_ADS,
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      platform,
      ad_account_id: ctx.externalId,
      external_campaign_id: linha.externalCampaignId,
      campaign_name: linha.campaignName ?? null,
      data_dia: linha.metricDate,
      investimento: Number(linha.spend ?? 0),
      impressoes: Number(linha.impressions ?? 0),
      cliques: Number(linha.clicks ?? 0),
      conversoes: Number(linha.conversions ?? 0),
      receita: Number(linha.revenue ?? 0),
      moeda: linha.currency ?? ctx.currency,
      versao_api: linha.versaoApi ?? null,
      execucao_id: ctx.execucaoId,
      inserido_em: agora(),
    }),
  };
}
