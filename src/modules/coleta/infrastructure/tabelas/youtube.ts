import { agora, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';

export const TABELAS_YOUTUBE: TabelasDaPlataforma = {
  padrao: {
    tipo: 'fato',
    staging: 'stg_youtube_diario',
    fato: 'fato_youtube_diario',
    chave: ['organization_id', 'channel_id', 'data_dia'],
    colunas: ['organization_id', 'channel_id', 'data_dia', 'views', 'minutos_assistidos', 'inscritos_ganhos', 'inscritos_perdidos', 'receita_estimada', 'execucao_id', 'inserido_em'],
    tipos: {
      organization_id: 'STRING', channel_id: 'STRING', data_dia: 'DATE', views: 'INT64',
      minutos_assistidos: 'NUMERIC', inscritos_ganhos: 'INT64', inscritos_perdidos: 'INT64', receita_estimada: 'NUMERIC',
      execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
    },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
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
};
