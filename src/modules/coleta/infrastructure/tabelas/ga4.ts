import { agora, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';

export const TABELAS_GA4: TabelasDaPlataforma = {
  padrao: {
    tipo: 'fato',
    staging: 'stg_ga4_diario',
    fato: 'fato_ga4_diario',
    chave: ['organization_id', 'property_id', 'canal', 'data_dia'],
    colunas: ['organization_id', 'property_id', 'canal', 'data_dia', 'sessoes', 'usuarios', 'novos_usuarios', 'conversoes', 'receita', 'execucao_id', 'inserido_em'],
    tipos: {
      organization_id: 'STRING', property_id: 'STRING', canal: 'STRING', data_dia: 'DATE',
      sessoes: 'INT64', usuarios: 'INT64', novos_usuarios: 'INT64', conversoes: 'NUMERIC', receita: 'NUMERIC',
      execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
    },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
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
};
