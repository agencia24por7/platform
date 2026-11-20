import { agora, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';
import { dimensaoScd2 } from '@/modules/coleta/infrastructure/tabelas/construtores';
import {
  TabelaGtm,
  acionadorDaLinha,
  conteinerDaLinha,
  tagDaLinha,
  variavelDaLinha,
  versaoDaLinha,
  workspaceDaLinha,
} from '@/modules/coleta/domain/catalogoGtm';

const FONTE = 'conteiner_id';

export const TABELAS_GTM: TabelasDaPlataforma = {
  padrao: {
    tipo: 'snapshot',
    tabela: 'gov_snapshot_fontes',
    chave: ['organization_id', 'fonte_id', 'execucao_id'],
    colunaMomento: 'visto_em',
    tipos: {
      organization_id: 'STRING', platform: 'STRING', fonte_tipo: 'STRING', fonte_id: 'STRING',
      nome: 'STRING', estado: 'STRING', inactive: 'BOOL', rotulo_esperado: 'STRING', rotulo_observado: 'STRING',
      visto_em: 'TIMESTAMP', execucao_id: 'STRING',
    },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      platform: 'gtm',
      fonte_tipo: 'connection_account',
      fonte_id: ctx.externalId,
      nome: linha.nome ?? null,
      estado: linha.estado ?? null,
      inactive: Boolean(linha.inactive),
      rotulo_esperado: linha.rotuloEsperado ?? null,
      rotulo_observado: linha.rotuloObservado ?? null,
      visto_em: agora(),
      execucao_id: ctx.execucaoId,
    }),
  },
  [TabelaGtm.Conteiner]: dimensaoScd2({
    colunaDaFonte: FONTE, staging: 'stg_dim_gtm_conteiner', dimensao: 'dim_gtm_conteiner_scd2', chaveLocal: [],
    atributos: ['nome', 'conta_gtm_id', 'conteiner_gtm_id', 'contexto_de_uso', 'dominios'], converter: conteinerDaLinha,
    tipos: { nome: 'STRING', conta_gtm_id: 'STRING', conteiner_gtm_id: 'STRING', contexto_de_uso: 'STRING', dominios: 'STRING' },
  }),
  [TabelaGtm.Workspace]: dimensaoScd2({
    colunaDaFonte: FONTE, staging: 'stg_dim_gtm_workspace', dimensao: 'dim_gtm_workspace_scd2', chaveLocal: ['workspace_id'],
    atributos: ['nome'], converter: workspaceDaLinha, tipos: { workspace_id: 'STRING', nome: 'STRING' },
  }),
  [TabelaGtm.Versao]: dimensaoScd2({
    colunaDaFonte: FONTE, staging: 'stg_dim_gtm_versao', dimensao: 'dim_gtm_versao_scd2', chaveLocal: [],
    atributos: ['versao_id', 'nome', 'total_tags', 'total_acionadores', 'total_variaveis'], converter: versaoDaLinha,
    tipos: { versao_id: 'STRING', nome: 'STRING', total_tags: 'INT64', total_acionadores: 'INT64', total_variaveis: 'INT64' },
  }),
  [TabelaGtm.Tag]: dimensaoScd2({
    colunaDaFonte: FONTE, staging: 'stg_dim_gtm_tag', dimensao: 'dim_gtm_tag_scd2', chaveLocal: ['tag_id'],
    atributos: ['nome', 'tipo', 'acionadores_disparo', 'acionadores_bloqueio', 'pausada'], converter: tagDaLinha,
    tipos: { tag_id: 'STRING', nome: 'STRING', tipo: 'STRING', acionadores_disparo: 'STRING', acionadores_bloqueio: 'STRING', pausada: 'BOOL' },
  }),
  [TabelaGtm.Acionador]: dimensaoScd2({
    colunaDaFonte: FONTE, staging: 'stg_dim_gtm_acionador', dimensao: 'dim_gtm_acionador_scd2', chaveLocal: ['acionador_id'],
    atributos: ['nome', 'tipo'], converter: acionadorDaLinha, tipos: { acionador_id: 'STRING', nome: 'STRING', tipo: 'STRING' },
  }),
  [TabelaGtm.Variavel]: dimensaoScd2({
    colunaDaFonte: FONTE, staging: 'stg_dim_gtm_variavel', dimensao: 'dim_gtm_variavel_scd2', chaveLocal: ['variavel_id'],
    atributos: ['nome', 'tipo'], converter: variavelDaLinha, tipos: { variavel_id: 'STRING', nome: 'STRING', tipo: 'STRING' },
  }),
};
