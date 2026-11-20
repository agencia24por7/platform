import { agora, type ConfiguracaoFato, type ConfiguracaoScd2, type ContextoGravacao, type LinhaBruta, type TiposDasColunas } from './tipos.ts';

const METRICAS_BASICAS: TiposDasColunas = {
  investimento: 'NUMERIC', impressoes: 'INT64', cliques: 'INT64', conversoes: 'NUMERIC', receita: 'NUMERIC',
  todas_conversoes: 'NUMERIC', todas_conversoes_receita: 'NUMERIC', interacoes: 'INT64',
};
const METRICAS_COMPLETAS: TiposDasColunas = { ...METRICAS_BASICAS, visualizacoes_video: 'INT64' };
const METRICAS_CONVERSAO: TiposDasColunas = {
  conversoes: 'NUMERIC', receita: 'NUMERIC', todas_conversoes: 'NUMERIC', todas_conversoes_receita: 'NUMERIC',
};
const PARCELAS_DE_IMPRESSAO: TiposDasColunas = {
  parcela_impressoes_pesquisa: 'NUMERIC', perdida_orcamento: 'NUMERIC', perdida_ranking: 'NUMERIC',
  parcela_topo: 'NUMERIC', parcela_topo_absoluto: 'NUMERIC',
};

const CHAVE_DA_CONTA: TiposDasColunas = { organization_id: 'STRING', ad_account_id: 'STRING' };
const CONTROLE: TiposDasColunas = { execucao_id: 'STRING', inserido_em: 'TIMESTAMP' };
const CAMPANHA: TiposDasColunas = { external_campaign_id: 'STRING' };
const GRUPO: TiposDasColunas = { ad_group_id: 'STRING' };

export type EspecFato = {
  readonly tabela: string;
  readonly chaveDoRecorte: TiposDasColunas;
  readonly metricas: TiposDasColunas;
  readonly atributos?: TiposDasColunas;
};

export type EspecDimensao = {
  readonly tabela: string;
  readonly chaveDaEntidade: TiposDasColunas;
  readonly atributos: TiposDasColunas;
};

export const ESPECIFICACAO_FATOS: readonly EspecFato[] = [
  { tabela: 'fato_google_campanha_diario', chaveDoRecorte: CAMPANHA, metricas: { ...METRICAS_COMPLETAS, ...PARCELAS_DE_IMPRESSAO } },
  { tabela: 'fato_google_anuncio_diario', chaveDoRecorte: { ...CAMPANHA, ...GRUPO, ad_id: 'STRING' }, metricas: METRICAS_COMPLETAS },
  { tabela: 'fato_google_palavra_chave_diario', chaveDoRecorte: { ...CAMPANHA, ...GRUPO, criterion_id: 'STRING' }, metricas: METRICAS_COMPLETAS },
  {
    tabela: 'fato_google_termo_pesquisa_diario',
    chaveDoRecorte: { ...CAMPANHA, ...GRUPO, termo: 'STRING' },
    metricas: METRICAS_COMPLETAS,
    atributos: { status_termo: 'STRING' },
  },
  {
    tabela: 'fato_google_conversao_diario',
    chaveDoRecorte: { ...CAMPANHA, conversion_action_id: 'STRING' },
    metricas: METRICAS_CONVERSAO,
    atributos: { acao_nome: 'STRING', acao_categoria: 'STRING' },
  },
  { tabela: 'fato_google_dispositivo_diario', chaveDoRecorte: { ...CAMPANHA, dispositivo: 'STRING' }, metricas: METRICAS_COMPLETAS },
  { tabela: 'fato_google_rede_diario', chaveDoRecorte: { ...CAMPANHA, rede: 'STRING' }, metricas: METRICAS_COMPLETAS },
  {
    tabela: 'fato_google_geo_diario',
    chaveDoRecorte: { ...CAMPANHA, pais_criterio_id: 'STRING', tipo_localizacao: 'STRING' },
    metricas: METRICAS_COMPLETAS,
  },
  { tabela: 'fato_google_idade_diario', chaveDoRecorte: { ...CAMPANHA, ...GRUPO, faixa_etaria: 'STRING' }, metricas: METRICAS_COMPLETAS },
  { tabela: 'fato_google_genero_diario', chaveDoRecorte: { ...CAMPANHA, ...GRUPO, genero: 'STRING' }, metricas: METRICAS_COMPLETAS },
  { tabela: 'fato_google_grupo_ativos_diario', chaveDoRecorte: { ...CAMPANHA, asset_group_id: 'STRING' }, metricas: METRICAS_BASICAS },
];

export const ESPECIFICACAO_DIMENSOES: readonly EspecDimensao[] = [
  {
    tabela: 'dim_google_campanha_scd2',
    chaveDaEntidade: CAMPANHA,
    atributos: {
      nome: 'STRING', status: 'STRING', canal: 'STRING', subcanal: 'STRING', estrategia_lance: 'STRING',
      orcamento: 'NUMERIC', orcamento_compartilhado: 'BOOL',
    },
  },
  {
    tabela: 'dim_google_grupo_anuncios_scd2',
    chaveDaEntidade: GRUPO,
    atributos: { external_campaign_id: 'STRING', nome: 'STRING', status: 'STRING', tipo: 'STRING' },
  },
  {
    tabela: 'dim_google_anuncio_scd2',
    chaveDaEntidade: { ad_id: 'STRING' },
    atributos: { ad_group_id: 'STRING', external_campaign_id: 'STRING', nome: 'STRING', tipo: 'STRING', status: 'STRING', aprovacao: 'STRING' },
  },
  {
    tabela: 'dim_google_palavra_chave_scd2',
    chaveDaEntidade: { ...GRUPO, criterion_id: 'STRING' },
    atributos: {
      external_campaign_id: 'STRING', texto: 'STRING', correspondencia: 'STRING', status: 'STRING',
      negativa: 'BOOL', nota_qualidade: 'INT64',
    },
  },
  {
    tabela: 'dim_google_grupo_ativos_scd2',
    chaveDaEntidade: { asset_group_id: 'STRING' },
    atributos: { external_campaign_id: 'STRING', nome: 'STRING', status: 'STRING' },
  },
];

export const nomeDoStaging = (tabela: string): string => tabela.replace(/^(fato|dim)_/, 'stg_').replace(/_scd2$/, '');

function valorDaColuna(coluna: string, chave: readonly string[], linha: LinhaBruta, ctx: ContextoGravacao): unknown {
  if (coluna === 'organization_id') return ctx.organizationId;
  if (coluna === 'ad_account_id') return ctx.externalId;
  if (coluna === 'moeda') return linha.moeda ?? ctx.currency;
  if (coluna === 'execucao_id') return ctx.execucaoId;
  if (coluna === 'inserido_em') return agora();
  const bruto = linha[coluna];
  if (bruto !== undefined && bruto !== null) return bruto;
  return chave.includes(coluna) ? '' : null;
}

function mapearColunas(tipos: TiposDasColunas, chave: readonly string[]) {
  return (linha: LinhaBruta, ctx: ContextoGravacao): Record<string, unknown> =>
    Object.fromEntries(Object.keys(tipos).map((coluna) => [coluna, valorDaColuna(coluna, chave, linha, ctx)]));
}

export function montarFato(espec: EspecFato): ConfiguracaoFato {
  const tipos: TiposDasColunas = {
    ...CHAVE_DA_CONTA, data_dia: 'DATE', ...espec.chaveDoRecorte, ...espec.atributos, ...espec.metricas, moeda: 'STRING', ...CONTROLE,
  };
  const chave = [...Object.keys(CHAVE_DA_CONTA), ...Object.keys(espec.chaveDoRecorte), 'data_dia'];
  return {
    tipo: 'fato',
    staging: nomeDoStaging(espec.tabela),
    fato: espec.tabela,
    chave,
    colunas: Object.keys(tipos),
    tipos,
    mapear: mapearColunas(tipos, chave),
  };
}

export function montarDimensao(espec: EspecDimensao): ConfiguracaoScd2 {
  const tipos: TiposDasColunas = { ...CHAVE_DA_CONTA, ...espec.chaveDaEntidade, ...espec.atributos };
  const chave = [...Object.keys(CHAVE_DA_CONTA), ...Object.keys(espec.chaveDaEntidade)];
  return {
    tipo: 'scd2',
    staging: nomeDoStaging(espec.tabela),
    dimensao: espec.tabela,
    chave,
    atributos: Object.keys(espec.atributos),
    tipos,
    mapear: mapearColunas(tipos, chave),
  };
}
