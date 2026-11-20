import { agora, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';

export const TABELAS_GBP: TabelasDaPlataforma = {
  padrao: {
    tipo: 'fato',
    staging: 'stg_gbp_diario',
    fato: 'fato_gbp_diario',
    chave: ['organization_id', 'location_id', 'data_dia', 'metrica'],
    colunas: ['organization_id', 'location_id', 'data_dia', 'metrica', 'valor', 'execucao_id', 'inserido_em'],
    tipos: {
      organization_id: 'STRING', location_id: 'STRING', data_dia: 'DATE', metrica: 'STRING',
      valor: 'NUMERIC', execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
    },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      location_id: ctx.externalId,
      data_dia: linha.metricDate,
      metrica: linha.metric,
      valor: Number(linha.value ?? 0),
      execucao_id: ctx.execucaoId,
      inserido_em: agora(),
    }),
  },
};
