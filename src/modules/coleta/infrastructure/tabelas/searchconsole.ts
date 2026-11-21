import { agora, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';
import { configuracoesDosRecortes } from '@/modules/coleta/infrastructure/tabelas/recortes';
import { RECORTES_SEARCH_CONSOLE } from '@/modules/coleta/domain/recortesSearchConsole';
import { textoDaDimensao } from '@/modules/coleta/domain/fatosDiarios';

export const TABELAS_SEARCHCONSOLE: TabelasDaPlataforma = {
  padrao: {
    tipo: 'fato',
    staging: 'stg_search_console_diario',
    fato: 'fato_search_console_diario',
    chave: ['organization_id', 'site', 'device', 'data_dia'],
    colunas: ['organization_id', 'site', 'device', 'data_dia', 'cliques', 'impressoes', 'ctr', 'posicao_media', 'execucao_id', 'inserido_em'],
    tipos: {
      organization_id: 'STRING', site: 'STRING', device: 'STRING', data_dia: 'DATE',
      cliques: 'INT64', impressoes: 'INT64', ctr: 'NUMERIC', posicao_media: 'NUMERIC',
      execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
    },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      site: ctx.externalId,
      device: textoDaDimensao(linha.device),
      data_dia: linha.metricDate,
      cliques: Number(linha.clicks ?? 0),
      impressoes: Number(linha.impressions ?? 0),
      ctr: Number(linha.ctr ?? 0),
      posicao_media: Number(linha.position ?? 0),
      execucao_id: ctx.execucaoId,
      inserido_em: agora(),
    }),
  },
  ...configuracoesDosRecortes(RECORTES_SEARCH_CONSOLE),
};
