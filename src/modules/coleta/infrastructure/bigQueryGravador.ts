import { BigQuery } from '@google-cloud/bigquery';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import type { Platform } from '@/modules/connections/domain/connection';
import type { RelatorioDeExecucao } from '@/modules/coleta/domain/qualidade';
import { linhaParaBigQuery, paraParametroBigQuery } from '@/modules/coleta/infrastructure/parametrosBigQuery';

type LinhaBruta = Record<string, unknown>;

export type ContextoGravacao = {
  readonly organizationId: string;
  readonly clientId: string;
  readonly externalId: string;
  readonly currency: string;
  readonly execucaoId: string;
};

type ConfiguracaoPlataforma = {
  readonly staging: string;
  readonly fato: string;
  readonly chave: readonly string[];
  readonly colunas: readonly string[];
  readonly tipos: Readonly<Record<string, string>>;
  readonly mapear: (linha: LinhaBruta, ctx: ContextoGravacao) => Record<string, unknown>;
};

const TIPOS_ADS = {
  organization_id: 'STRING', client_id: 'STRING', platform: 'STRING', ad_account_id: 'STRING',
  external_campaign_id: 'STRING', campaign_name: 'STRING', data_dia: 'DATE', investimento: 'NUMERIC',
  impressoes: 'INT64', cliques: 'INT64', conversoes: 'NUMERIC', receita: 'NUMERIC', moeda: 'STRING',
  versao_api: 'STRING', execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
} as const;

const agora = () => new Date().toISOString();

const CONFIG_POR_PLATAFORMA: Partial<Record<Platform, ConfiguracaoPlataforma>> = {
  google: {
    staging: 'stg_ads_diario',
    fato: 'fato_ads_diario',
    chave: ['organization_id', 'client_id', 'ad_account_id', 'external_campaign_id', 'data_dia'],
    colunas: [
      'organization_id', 'client_id', 'platform', 'ad_account_id', 'external_campaign_id', 'campaign_name',
      'data_dia', 'investimento', 'impressoes', 'cliques', 'conversoes', 'receita', 'moeda', 'versao_api',
      'execucao_id', 'inserido_em',
    ],
    tipos: TIPOS_ADS,
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      client_id: ctx.clientId,
      platform: 'google',
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
  },
  meta: {
    staging: 'stg_ads_diario',
    fato: 'fato_ads_diario',
    chave: ['organization_id', 'client_id', 'ad_account_id', 'external_campaign_id', 'data_dia'],
    colunas: [
      'organization_id', 'client_id', 'platform', 'ad_account_id', 'external_campaign_id', 'campaign_name',
      'data_dia', 'investimento', 'impressoes', 'cliques', 'conversoes', 'receita', 'moeda', 'versao_api',
      'execucao_id', 'inserido_em',
    ],
    tipos: TIPOS_ADS,
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      client_id: ctx.clientId,
      platform: 'meta',
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
  },
  ga4: {
    staging: 'stg_ga4_diario',
    fato: 'fato_ga4_diario',
    chave: ['organization_id', 'client_id', 'property_id', 'canal', 'data_dia'],
    colunas: ['organization_id', 'client_id', 'property_id', 'canal', 'data_dia', 'sessoes', 'usuarios', 'novos_usuarios', 'conversoes', 'receita', 'execucao_id', 'inserido_em'],
    tipos: {
      organization_id: 'STRING', client_id: 'STRING', property_id: 'STRING', canal: 'STRING', data_dia: 'DATE',
      sessoes: 'INT64', usuarios: 'INT64', novos_usuarios: 'INT64', conversoes: 'NUMERIC', receita: 'NUMERIC',
      execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
    },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      client_id: ctx.clientId,
      property_id: ctx.externalId,
      canal: linha.canal ?? null,
      data_dia: linha.metricDate,
      sessoes: Number(linha.sessoes ?? 0),
      usuarios: Number(linha.usuarios ?? 0),
      novos_usuarios: Number(linha.novosUsuarios ?? 0),
      conversoes: Number(linha.conversoes ?? 0),
      receita: Number(linha.receita ?? 0),
      execucao_id: ctx.execucaoId,
      inserido_em: agora(),
    }),
  },
  searchconsole: {
    staging: 'stg_search_console_diario',
    fato: 'fato_search_console_diario',
    chave: ['organization_id', 'client_id', 'site', 'device', 'data_dia'],
    colunas: ['organization_id', 'client_id', 'site', 'device', 'data_dia', 'cliques', 'impressoes', 'ctr', 'posicao_media', 'execucao_id', 'inserido_em'],
    tipos: {
      organization_id: 'STRING', client_id: 'STRING', site: 'STRING', device: 'STRING', data_dia: 'DATE',
      cliques: 'INT64', impressoes: 'INT64', ctr: 'NUMERIC', posicao_media: 'NUMERIC',
      execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
    },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      client_id: ctx.clientId,
      site: ctx.externalId,
      device: linha.device ?? null,
      data_dia: linha.metricDate,
      cliques: Number(linha.clicks ?? 0),
      impressoes: Number(linha.impressions ?? 0),
      ctr: Number(linha.ctr ?? 0),
      posicao_media: Number(linha.position ?? 0),
      execucao_id: ctx.execucaoId,
      inserido_em: agora(),
    }),
  },
  youtube: {
    staging: 'stg_youtube_diario',
    fato: 'fato_youtube_diario',
    chave: ['organization_id', 'client_id', 'channel_id', 'data_dia'],
    colunas: ['organization_id', 'client_id', 'channel_id', 'data_dia', 'views', 'minutos_assistidos', 'inscritos_ganhos', 'inscritos_perdidos', 'receita_estimada', 'execucao_id', 'inserido_em'],
    tipos: {
      organization_id: 'STRING', client_id: 'STRING', channel_id: 'STRING', data_dia: 'DATE', views: 'INT64',
      minutos_assistidos: 'NUMERIC', inscritos_ganhos: 'INT64', inscritos_perdidos: 'INT64', receita_estimada: 'NUMERIC',
      execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
    },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      client_id: ctx.clientId,
      channel_id: ctx.externalId,
      data_dia: linha.metricDate,
      views: Number(linha.views ?? 0),
      minutos_assistidos: Number(linha.minutesWatched ?? 0),
      inscritos_ganhos: Number(linha.subscribersGained ?? 0),
      inscritos_perdidos: Number(linha.subscribersLost ?? 0),
      receita_estimada: Number(linha.estimatedRevenue ?? 0),
      execucao_id: ctx.execucaoId,
      inserido_em: agora(),
    }),
  },
  gbp: {
    staging: 'stg_gbp_diario',
    fato: 'fato_gbp_diario',
    chave: ['organization_id', 'client_id', 'location_id', 'data_dia', 'metrica'],
    colunas: ['organization_id', 'client_id', 'location_id', 'data_dia', 'metrica', 'valor', 'execucao_id', 'inserido_em'],
    tipos: {
      organization_id: 'STRING', client_id: 'STRING', location_id: 'STRING', data_dia: 'DATE', metrica: 'STRING',
      valor: 'NUMERIC', execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
    },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      client_id: ctx.clientId,
      location_id: ctx.externalId,
      data_dia: linha.metricDate,
      metrica: linha.metric,
      valor: Number(linha.value ?? 0),
      execucao_id: ctx.execucaoId,
      inserido_em: agora(),
    }),
  },
};

const PLATAFORMAS_SNAPSHOT: ReadonlySet<Platform> = new Set(['gtm']);

const TIPOS_SNAPSHOT = {
  organization_id: 'STRING', client_id: 'STRING', platform: 'STRING', fonte_tipo: 'STRING', fonte_id: 'STRING',
  nome: 'STRING', estado: 'STRING', inactive: 'BOOL', rotulo_esperado: 'STRING', rotulo_observado: 'STRING',
  visto_em: 'TIMESTAMP',
} as const;

export type ResultadoGravacao =
  | { readonly ok: true; readonly linhasGravadas: number }
  | { readonly ok: false; readonly motivo: string };

export type BigQueryGravador = {
  readonly available: boolean;
  gravar(platform: Platform, linhas: readonly LinhaBruta[], ctx: ContextoGravacao): Promise<ResultadoGravacao>;
  registrarQc(execucao: {
    readonly organizationId: string;
    readonly clientId: string;
    readonly execucaoId: string;
    readonly platform: Platform;
    readonly fonteId: string;
    readonly modo: string;
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly status: string;
    readonly qualidadeResumo: RelatorioDeExecucao | null;
  }): Promise<void>;
};

export function createBigQueryGravador(): BigQueryGravador {
  const config = env();
  const available = Boolean(config.BQ_PROJECT_ID);
  const bigquery = available ? new BigQuery({ projectId: config.BQ_PROJECT_ID }) : null;
  const dataset = config.BQ_DATASET;

  async function mergeParaFato(cfg: ConfiguracaoPlataforma, execucaoId: string): Promise<void> {
    const onClause = cfg.chave.map((coluna) => `alvo.${coluna} = origem.${coluna}`).join(' AND ');
    const setClause = cfg.colunas
      .filter((coluna) => !cfg.chave.includes(coluna))
      .map((coluna) => `${coluna} = origem.${coluna}`)
      .join(', ');
    const insertColunas = cfg.colunas.join(', ');
    const insertValores = cfg.colunas.map((coluna) => `origem.${coluna}`).join(', ');

    const query = `
      MERGE \`${config.BQ_PROJECT_ID}.${dataset}.${cfg.fato}\` AS alvo
      USING (SELECT * FROM \`${config.BQ_PROJECT_ID}.${dataset}.${cfg.staging}\` WHERE execucao_id = @execucaoId) AS origem
      ON ${onClause}
      WHEN MATCHED THEN UPDATE SET ${setClause}
      WHEN NOT MATCHED THEN INSERT (${insertColunas}) VALUES (${insertValores})
    `;

    const [job] = await bigquery!.createQueryJob({ query, params: { execucaoId } });
    await job.getQueryResults();
  }

  async function gravarSnapshot(platform: Platform, linhas: readonly LinhaBruta[], ctx: ContextoGravacao): Promise<ResultadoGravacao> {
    if (linhas.length === 0) return { ok: true, linhasGravadas: 0 };

    const snapshots = linhas.map((linha) => ({
      organization_id: ctx.organizationId,
      client_id: ctx.clientId,
      platform,
      fonte_tipo: 'connection_account',
      fonte_id: ctx.externalId,
      nome: linha.nome ?? null,
      estado: linha.estado ?? null,
      inactive: Boolean(linha.inactive),
      rotulo_esperado: linha.rotuloEsperado ?? null,
      rotulo_observado: linha.rotuloObservado ?? null,
      visto_em: agora(),
    }));

    try {
      const colunas = Object.keys(snapshots[0]!).join(', ');
      const [job] = await bigquery!.createQueryJob({
        query: `INSERT INTO \`${config.BQ_PROJECT_ID}.${dataset}.gov_snapshot_fontes\` (${colunas})
          SELECT ${colunas} FROM UNNEST(@linhas)`,
        params: { linhas: snapshots.map((snapshot) => linhaParaBigQuery(snapshot, TIPOS_SNAPSHOT)) },
        types: { linhas: [TIPOS_SNAPSHOT] },
      });
      await job.getQueryResults();
      return { ok: true, linhasGravadas: snapshots.length };
    } catch (error) {
      logger.error('coleta.bigquery.snapshot.erro', {
        platform,
        error: error instanceof Error ? error.message : 'desconhecido',
      });
      return { ok: false, motivo: 'falha_ao_gravar' };
    }
  }

  return {
    available,

    async gravar(platform, linhas, ctx) {
      if (!available || !bigquery) return { ok: false, motivo: 'bigquery_indisponivel' };
      if (PLATAFORMAS_SNAPSHOT.has(platform)) return gravarSnapshot(platform, linhas, ctx);

      const cfg = CONFIG_POR_PLATAFORMA[platform];
      if (!cfg) return { ok: false, motivo: 'plataforma_sem_mapeamento' };
      if (linhas.length === 0) return { ok: true, linhasGravadas: 0 };

      const linhasMapeadas = linhas.map((linha) => linhaParaBigQuery(cfg.mapear(linha, ctx), cfg.tipos));

      try {
        const colunasQuery = cfg.colunas.join(', ');
        const query = `INSERT INTO \`${config.BQ_PROJECT_ID}.${dataset}.${cfg.staging}\` (${colunasQuery})
          SELECT ${colunasQuery} FROM UNNEST(@linhas)`;
        const [job] = await bigquery.createQueryJob({
          query,
          params: { linhas: linhasMapeadas },
          types: { linhas: [cfg.tipos] },
        });
        await job.getQueryResults();

        await mergeParaFato(cfg, ctx.execucaoId);
        return { ok: true, linhasGravadas: linhasMapeadas.length };
      } catch (error) {
        logger.error('coleta.bigquery.gravar.erro', {
          platform,
          error: error instanceof Error ? error.message : 'desconhecido',
        });
        return { ok: false, motivo: 'falha_ao_gravar' };
      }
    },

    async registrarQc(execucao) {
      if (!available || !bigquery) return;

      try {
        const query = `INSERT INTO \`${config.BQ_PROJECT_ID}.${dataset}.qc_execucoes\`
          (organization_id, client_id, execucao_id, platform, fonte_id, modo, window_start, window_end,
           fontes_esperadas, fontes_coletadas, linhas, bytes, requests, duracao_ms, status, qualidade_resumo, criado_em)
          VALUES (@organizationId, @clientId, @execucaoId, @platform, @fonteId, @modo, @windowStart, @windowEnd,
           @fontesEsperadas, @fontesColetadas, @linhas, @bytes, @requests, @duracaoMs, @status, PARSE_JSON(@qualidadeResumo), @criadoEm)`;

        const [job] = await bigquery.createQueryJob({
          query,
          params: {
            organizationId: execucao.organizationId,
            clientId: execucao.clientId,
            execucaoId: execucao.execucaoId,
            platform: execucao.platform,
            fonteId: execucao.fonteId,
            modo: execucao.modo,
            windowStart: paraParametroBigQuery(execucao.windowStart, 'DATE'),
            windowEnd: paraParametroBigQuery(execucao.windowEnd, 'DATE'),
            fontesEsperadas: execucao.qualidadeResumo?.fontesEsperadas ?? null,
            fontesColetadas: execucao.qualidadeResumo?.fontesColetadas ?? null,
            linhas: execucao.qualidadeResumo?.volumetria.linhas ?? null,
            bytes: execucao.qualidadeResumo?.volumetria.bytes ?? null,
            requests: execucao.qualidadeResumo?.volumetria.requests ?? null,
            duracaoMs: execucao.qualidadeResumo?.volumetria.duracaoMs ?? null,
            status: execucao.status,
            qualidadeResumo: execucao.qualidadeResumo ? JSON.stringify(execucao.qualidadeResumo) : '{}',
            criadoEm: paraParametroBigQuery(agora(), 'TIMESTAMP'),
          },
          types: {
            windowStart: 'DATE',
            windowEnd: 'DATE',
            fontesEsperadas: 'INT64',
            fontesColetadas: 'INT64',
            linhas: 'INT64',
            bytes: 'INT64',
            requests: 'INT64',
            duracaoMs: 'INT64',
            criadoEm: 'TIMESTAMP',
          },
        });
        await job.getQueryResults();
      } catch (error) {
        logger.error('coleta.bigquery.qc.erro', { error: error instanceof Error ? error.message : 'desconhecido' });
      }
    },
  };
}
