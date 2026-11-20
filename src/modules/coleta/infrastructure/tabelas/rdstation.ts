import { agora, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';
import { COLUNAS_DO_FATO_RD, dataDoSnapshot, linhaDoFatoRd, negociacoesUnicas, type NegociacaoRd } from '@/modules/coleta/domain/negociacoesRd';

const TIPOS_RD = {
  organization_id: 'STRING', conta_id: 'STRING', deal_id: 'STRING', data_snapshot: 'DATE', pipeline_id: 'STRING',
  pipeline_nome: 'STRING', etapa_id: 'STRING', etapa_nome: 'STRING', etapa_ordem: 'INT64', situacao: 'STRING',
  valor_total: 'NUMERIC', valor_mensal: 'NUMERIC', valor_unico: 'NUMERIC', moeda: 'STRING', criada_em: 'TIMESTAMP',
  atualizada_em: 'TIMESTAMP', fechada_em: 'TIMESTAMP', fonte_nome: 'STRING', campanha_nome: 'STRING',
  execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
} as const;

type NegociacaoDoDia = NegociacaoRd & { readonly dataSnapshot: string };

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
};
