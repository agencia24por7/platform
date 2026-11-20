import { agora, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';
import { dimensaoScd2, fatoDeLinhas } from '@/modules/coleta/infrastructure/tabelas/construtores';
import {
  TabelaRd,
  campanhaDaLinha,
  etapaDaLinha,
  etapaDaNegociacaoDaLinha,
  fonteDaLinha,
  funilDaLinha,
  produtoDaLinha,
  produtoDaNegociacaoDaLinha,
  tarefaPorDiaDaLinha,
  usuarioDaLinha,
} from '@/modules/coleta/domain/catalogoRd';
import { COLUNAS_DO_FATO_RD, dataDoSnapshot, linhaDoFatoRd, negociacoesUnicas, type NegociacaoRd } from '@/modules/coleta/domain/negociacoesRd';

const TIPOS_RD = {
  organization_id: 'STRING', conta_id: 'STRING', deal_id: 'STRING', data_snapshot: 'DATE', pipeline_id: 'STRING',
  pipeline_nome: 'STRING', etapa_id: 'STRING', etapa_nome: 'STRING', etapa_ordem: 'INT64', situacao: 'STRING',
  valor_total: 'NUMERIC', valor_mensal: 'NUMERIC', valor_unico: 'NUMERIC', moeda: 'STRING', criada_em: 'TIMESTAMP',
  atualizada_em: 'TIMESTAMP', fechada_em: 'TIMESTAMP', fonte_nome: 'STRING', campanha_nome: 'STRING',
  responsavel_id: 'STRING', fonte_id: 'STRING', campanha_id: 'STRING',
  execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
} as const;

type NegociacaoDoDia = NegociacaoRd & { readonly dataSnapshot: string };

const FONTE = 'conta_id';

export const TABELAS_RDSTATION: TabelasDaPlataforma = {
  padrao: {
    tipo: 'fato',
    staging: 'stg_rd_negociacoes',
    fato: 'fato_rd_negociacoes',
    chave: ['organization_id', 'conta_id', 'deal_id', 'data_snapshot'],
    colunas: COLUNAS_DO_FATO_RD,
    tipos: TIPOS_RD,
    preparar: (linhas) => {
      const dataSnapshot = dataDoSnapshot(new Date());
      return negociacoesUnicas(linhas).map((negociacao) => ({ ...negociacao, dataSnapshot }));
    },
    mapear: (linha, ctx) => {
      const negociacao = linha as unknown as NegociacaoDoDia;
      return linhaDoFatoRd(negociacao, {
        organizationId: ctx.organizationId,
        contaId: ctx.externalId,
        dataSnapshot: negociacao.dataSnapshot,
        moeda: ctx.currency,
        execucaoId: ctx.execucaoId,
        inseridoEm: agora(),
      });
    },
  },
  [TabelaRd.Funil]: dimensaoScd2({
    colunaDaFonte: FONTE, staging: 'stg_dim_rd_funil', dimensao: 'dim_rd_funil_scd2', chaveLocal: ['funil_id'],
    atributos: ['nome'], converter: funilDaLinha, tipos: { funil_id: 'STRING', nome: 'STRING' },
  }),
  [TabelaRd.Etapa]: dimensaoScd2({
    colunaDaFonte: FONTE, staging: 'stg_dim_rd_etapa', dimensao: 'dim_rd_etapa_scd2', chaveLocal: ['etapa_id'],
    atributos: ['funil_id', 'nome', 'ordem'], converter: etapaDaLinha,
    tipos: { etapa_id: 'STRING', funil_id: 'STRING', nome: 'STRING', ordem: 'INT64' },
  }),
  [TabelaRd.Fonte]: dimensaoScd2({
    colunaDaFonte: FONTE, staging: 'stg_dim_rd_fonte', dimensao: 'dim_rd_fonte_scd2', chaveLocal: ['fonte_id'],
    atributos: ['nome'], converter: fonteDaLinha, tipos: { fonte_id: 'STRING', nome: 'STRING' },
  }),
  [TabelaRd.Campanha]: dimensaoScd2({
    colunaDaFonte: FONTE, staging: 'stg_dim_rd_campanha', dimensao: 'dim_rd_campanha_scd2', chaveLocal: ['campanha_id'],
    atributos: ['nome'], converter: campanhaDaLinha, tipos: { campanha_id: 'STRING', nome: 'STRING' },
  }),
  [TabelaRd.Produto]: dimensaoScd2({
    colunaDaFonte: FONTE, staging: 'stg_dim_rd_produto', dimensao: 'dim_rd_produto_scd2', chaveLocal: ['produto_id'],
    atributos: ['nome', 'preco', 'ativo'], converter: produtoDaLinha,
    tipos: { produto_id: 'STRING', nome: 'STRING', preco: 'NUMERIC', ativo: 'BOOL' },
  }),
  [TabelaRd.Usuario]: dimensaoScd2({
    colunaDaFonte: FONTE, staging: 'stg_dim_rd_usuario', dimensao: 'dim_rd_usuario_scd2', chaveLocal: ['usuario_id'],
    atributos: ['ativo'], converter: usuarioDaLinha, tipos: { usuario_id: 'STRING', ativo: 'BOOL' },
  }),
  [TabelaRd.ProdutoDaNegociacao]: fatoDeLinhas({
    colunaDaFonte: FONTE, staging: 'stg_rd_negociacao_produtos', fato: 'fato_rd_negociacao_produtos',
    chaveLocal: ['deal_id', 'deal_produto_id', 'data_snapshot'],
    metricas: ['produto_id', 'quantidade', 'preco', 'desconto', 'total'],
    converter: (linha) => produtoDaNegociacaoDaLinha(dataDoSnapshot(new Date()))(linha),
    tipos: {
      deal_id: 'STRING', deal_produto_id: 'STRING', data_snapshot: 'DATE', produto_id: 'STRING',
      quantidade: 'NUMERIC', preco: 'NUMERIC', desconto: 'NUMERIC', total: 'NUMERIC',
    },
  }),
  [TabelaRd.EtapaDaNegociacao]: fatoDeLinhas({
    colunaDaFonte: FONTE, staging: 'stg_rd_negociacao_etapas', fato: 'fato_rd_negociacao_etapas',
    chaveLocal: ['deal_id', 'etapa_id', 'entrou_em'], metricas: ['data_dia'], converter: etapaDaNegociacaoDaLinha,
    tipos: { deal_id: 'STRING', etapa_id: 'STRING', entrou_em: 'TIMESTAMP', data_dia: 'DATE' },
  }),
  [TabelaRd.TarefaPorDia]: fatoDeLinhas({
    colunaDaFonte: FONTE, staging: 'stg_rd_tarefas_diarias', fato: 'fato_rd_tarefas_diarias',
    chaveLocal: ['data_dia', 'tipo', 'status'], metricas: ['quantidade'], converter: tarefaPorDiaDaLinha,
    tipos: { data_dia: 'DATE', tipo: 'STRING', status: 'STRING', quantidade: 'INT64' },
  }),
};
