import { agora, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';
import { COLUNAS_DO_FATO_EVENTOS, TIPOS_DO_FATO_EVENTOS, eventosUnicos, linhaDoFatoEventos, type EventoDoDia } from '@/modules/coleta/domain/eventosDoDataset';

export const TABELAS_PIXEL: TabelasDaPlataforma = {
  padrao: {
    tipo: 'fato',
    staging: 'stg_meta_eventos_dataset',
    fato: 'fato_meta_eventos_dataset',
    chave: ['organization_id', 'dataset_id', 'data_dia', 'evento', 'origem'],
    colunas: COLUNAS_DO_FATO_EVENTOS,
    tipos: TIPOS_DO_FATO_EVENTOS,
    preparar: (linhas) => eventosUnicos(linhas),
    mapear: (linha, ctx) =>
      linhaDoFatoEventos(linha as unknown as EventoDoDia, {
        organizationId: ctx.organizationId,
        datasetId: ctx.externalId,
        execucaoId: ctx.execucaoId,
        inseridoEm: agora(),
      }),
  },
};
