import { agora, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';
import { dimensaoScd2, fatoDeLinhas } from '@/modules/coleta/infrastructure/tabelas/construtores';
import { TabelaPixel, datasetDaLinha, recorteDaLinha } from '@/modules/coleta/domain/recortesDoDataset';
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
  [TabelaPixel.Dataset]: dimensaoScd2({
    colunaDaFonte: 'dataset_id', staging: 'stg_dim_meta_dataset', dimensao: 'dim_meta_dataset_scd2', chaveLocal: [],
    atributos: ['nome', 'indisponivel', 'correspondencia_automatica', 'cookie_primeira_parte', 'uso_de_dados'],
    converter: datasetDaLinha,
    tipos: { nome: 'STRING', indisponivel: 'BOOL', correspondencia_automatica: 'BOOL', cookie_primeira_parte: 'STRING', uso_de_dados: 'STRING' },
  }),
  [TabelaPixel.Recortes]: fatoDeLinhas({
    colunaDaFonte: 'dataset_id', staging: 'stg_meta_eventos_dataset_recortes', fato: 'fato_meta_eventos_dataset_recortes',
    chaveLocal: ['data_dia', 'recorte', 'valor'], metricas: ['quantidade'], converter: recorteDaLinha,
    tipos: { data_dia: 'DATE', recorte: 'STRING', valor: 'STRING', quantidade: 'INT64' },
  }),
};
