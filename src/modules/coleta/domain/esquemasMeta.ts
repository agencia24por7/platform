export type TipoDeColuna = 'STRING' | 'DATE' | 'INT64' | 'NUMERIC' | 'TIMESTAMP';

export type ColunaMeta = readonly [nome: string, tipo: TipoDeColuna];

export type EsquemaMeta = {
  readonly nome: string;
  readonly tabela: string;
  readonly staging: string;
  readonly view: string;
  readonly tipo: 'fato' | 'scd2';
  readonly chave: readonly string[];
  readonly colunas: readonly ColunaMeta[];
  readonly colunaDeData?: string;
  readonly cluster: readonly string[];
};

const MOEDA: ColunaMeta = ['moeda', 'STRING'];

const IDS_DO_ANUNCIO: readonly ColunaMeta[] = [
  ['campaign_id', 'STRING'],
  ['adset_id', 'STRING'],
  ['ad_id', 'STRING'],
  ['data_dia', 'DATE'],
];

const IDS_DO_CONJUNTO: readonly ColunaMeta[] = [
  ['campaign_id', 'STRING'],
  ['adset_id', 'STRING'],
  ['data_dia', 'DATE'],
];

const METRICAS_DO_RECORTE: readonly ColunaMeta[] = [
  ['investimento', 'NUMERIC'],
  ['impressoes', 'INT64'],
  ['alcance', 'INT64'],
  ['cliques', 'INT64'],
  ['cliques_link', 'INT64'],
  ['leads', 'INT64'],
  ['compras', 'INT64'],
  ['receita_compras', 'NUMERIC'],
  ['conversas_iniciadas', 'INT64'],
  ['visualizacoes_pagina', 'INT64'],
  MOEDA,
];

const CONTAGENS_DE_VIDEO = [
  'video_reproducoes', 'video_30s', 'video_p25', 'video_p50', 'video_p75', 'video_p95', 'video_p100', 'video_thruplay',
] as const;

export const ESQUEMAS_META: Readonly<Record<string, EsquemaMeta>> = {
  entrega_diaria: {
    nome: 'entrega_diaria',
    tabela: 'fato_meta_entrega_diaria',
    staging: 'stg_meta_entrega_diaria',
    view: 'vw_meta_entrega_diaria',
    tipo: 'fato',
    chave: ['ad_id', 'data_dia'],
    colunaDeData: 'data_dia',
    cluster: ['campaign_id'],
    colunas: [
      ...IDS_DO_ANUNCIO,
      ['investimento', 'NUMERIC'],
      ['impressoes', 'INT64'],
      ['alcance', 'INT64'],
      ['frequencia', 'NUMERIC'],
      ['cliques', 'INT64'],
      ['cliques_link', 'INT64'],
      ['cliques_unicos', 'INT64'],
      ['cliques_link_unicos', 'INT64'],
      ['cliques_saida', 'INT64'],
      ['engajamento_post', 'INT64'],
      ...CONTAGENS_DE_VIDEO.map((nome): ColunaMeta => [nome, 'INT64']),
      ['video_tempo_medio', 'NUMERIC'],
      ['ranking_qualidade', 'STRING'],
      ['ranking_engajamento', 'STRING'],
      ['ranking_conversao', 'STRING'],
      MOEDA,
    ],
  },
  acoes_diarias: {
    nome: 'acoes_diarias',
    tabela: 'fato_meta_acoes_diarias',
    staging: 'stg_meta_acoes_diarias',
    view: 'vw_meta_acoes_diarias',
    tipo: 'fato',
    chave: ['ad_id', 'data_dia', 'tipo_acao', 'origem_metrica'],
    colunaDeData: 'data_dia',
    cluster: ['campaign_id', 'tipo_acao'],
    colunas: [
      ...IDS_DO_ANUNCIO,
      ['tipo_acao', 'STRING'],
      ['origem_metrica', 'STRING'],
      ['quantidade', 'NUMERIC'],
      ['valor', 'NUMERIC'],
      ['custo_por_acao', 'NUMERIC'],
      ['janela_atribuicao', 'STRING'],
      MOEDA,
    ],
  },
  recorte_idade_genero: {
    nome: 'recorte_idade_genero',
    tabela: 'fato_meta_recorte_idade_genero',
    staging: 'stg_meta_recorte_idade_genero',
    view: 'vw_meta_recorte_idade_genero',
    tipo: 'fato',
    chave: ['adset_id', 'data_dia', 'idade', 'genero'],
    colunaDeData: 'data_dia',
    cluster: ['campaign_id'],
    colunas: [...IDS_DO_CONJUNTO, ['idade', 'STRING'], ['genero', 'STRING'], ...METRICAS_DO_RECORTE],
  },
  recorte_posicionamento: {
    nome: 'recorte_posicionamento',
    tabela: 'fato_meta_recorte_posicionamento',
    staging: 'stg_meta_recorte_posicionamento',
    view: 'vw_meta_recorte_posicionamento',
    tipo: 'fato',
    chave: ['adset_id', 'data_dia', 'plataforma_publicacao', 'posicao_plataforma'],
    colunaDeData: 'data_dia',
    cluster: ['campaign_id'],
    colunas: [
      ...IDS_DO_CONJUNTO,
      ['plataforma_publicacao', 'STRING'],
      ['posicao_plataforma', 'STRING'],
      ...METRICAS_DO_RECORTE,
    ],
  },
  recorte_regiao: {
    nome: 'recorte_regiao',
    tabela: 'fato_meta_recorte_regiao',
    staging: 'stg_meta_recorte_regiao',
    view: 'vw_meta_recorte_regiao',
    tipo: 'fato',
    chave: ['adset_id', 'data_dia', 'regiao'],
    colunaDeData: 'data_dia',
    cluster: ['campaign_id'],
    colunas: [...IDS_DO_CONJUNTO, ['regiao', 'STRING'], ...METRICAS_DO_RECORTE],
  },
  dim_campanha: {
    nome: 'dim_campanha',
    tabela: 'dim_meta_campanha_scd2',
    staging: 'stg_meta_dim_campanha',
    view: 'vw_meta_campanha',
    tipo: 'scd2',
    chave: ['campaign_id'],
    cluster: ['campaign_id'],
    colunas: [
      ['campaign_id', 'STRING'],
      ['nome', 'STRING'],
      ['objetivo', 'STRING'],
      ['status', 'STRING'],
      ['status_efetivo', 'STRING'],
      ['tipo_compra', 'STRING'],
      ['estrategia_lance', 'STRING'],
      ['orcamento_diario', 'NUMERIC'],
      ['orcamento_vitalicio', 'NUMERIC'],
      ['limite_gasto', 'NUMERIC'],
      ['categorias_especiais', 'STRING'],
      ['inicio', 'TIMESTAMP'],
      ['fim', 'TIMESTAMP'],
      ['criada_em', 'TIMESTAMP'],
    ],
  },
  dim_conjunto: {
    nome: 'dim_conjunto',
    tabela: 'dim_meta_conjunto_scd2',
    staging: 'stg_meta_dim_conjunto',
    view: 'vw_meta_conjunto',
    tipo: 'scd2',
    chave: ['adset_id'],
    cluster: ['adset_id'],
    colunas: [
      ['adset_id', 'STRING'],
      ['campaign_id', 'STRING'],
      ['nome', 'STRING'],
      ['status', 'STRING'],
      ['status_efetivo', 'STRING'],
      ['objetivo_otimizacao', 'STRING'],
      ['evento_cobranca', 'STRING'],
      ['estrategia_lance', 'STRING'],
      ['valor_lance', 'NUMERIC'],
      ['orcamento_diario', 'NUMERIC'],
      ['orcamento_vitalicio', 'NUMERIC'],
      ['tipo_destino', 'STRING'],
      ['evento_conversao', 'STRING'],
      ['janela_atribuicao', 'STRING'],
      ['inicio', 'TIMESTAMP'],
      ['fim', 'TIMESTAMP'],
      ['criado_em', 'TIMESTAMP'],
    ],
  },
  dim_anuncio: {
    nome: 'dim_anuncio',
    tabela: 'dim_meta_anuncio_scd2',
    staging: 'stg_meta_dim_anuncio',
    view: 'vw_meta_anuncio',
    tipo: 'scd2',
    chave: ['ad_id'],
    cluster: ['ad_id'],
    colunas: [
      ['ad_id', 'STRING'],
      ['campaign_id', 'STRING'],
      ['adset_id', 'STRING'],
      ['nome', 'STRING'],
      ['status', 'STRING'],
      ['status_efetivo', 'STRING'],
      ['creative_id', 'STRING'],
      ['criado_em', 'TIMESTAMP'],
    ],
  },
};

const TAMANHO_MAXIMO_DE_TEXTO = 500;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

function numero(bruto: unknown): number | null {
  const valor = typeof bruto === 'string' && bruto.trim() !== '' ? Number(bruto) : bruto;
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function instante(bruto: unknown): string | null {
  if (typeof bruto !== 'string' || !bruto) return null;
  const data = new Date(bruto.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

export function converterColuna(tipo: TipoDeColuna, bruto: unknown): string | number | null {
  if (bruto === null || bruto === undefined) return null;
  if (tipo === 'INT64') {
    const valor = numero(bruto);
    return valor === null ? null : Math.trunc(valor);
  }
  if (tipo === 'NUMERIC') return numero(bruto);
  if (tipo === 'DATE') return typeof bruto === 'string' && DIA.test(bruto) ? bruto : null;
  if (tipo === 'TIMESTAMP') return instante(bruto);
  if (typeof bruto !== 'string' && typeof bruto !== 'number') return null;
  const texto = String(bruto).trim();
  return texto ? texto.slice(0, TAMANHO_MAXIMO_DE_TEXTO) : null;
}

export function colunasDoEsquema(esquema: EsquemaMeta): readonly string[] {
  return esquema.colunas.map(([nome]) => nome);
}

export function atributosDoEsquema(esquema: EsquemaMeta): readonly string[] {
  return colunasDoEsquema(esquema).filter((nome) => !esquema.chave.includes(nome));
}

export function tiposDoEsquema(esquema: EsquemaMeta): Readonly<Record<string, string>> {
  const base: Record<string, string> = { organization_id: 'STRING', ad_account_id: 'STRING' };
  for (const [nome, tipo] of esquema.colunas) base[nome] = tipo;
  if (esquema.tipo === 'fato') {
    base.versao_api = 'STRING';
    base.execucao_id = 'STRING';
    base.inserido_em = 'TIMESTAMP';
  }
  return base;
}

export function linhaTipada(esquema: EsquemaMeta, linha: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [nome, tipo] of esquema.colunas) saida[nome] = converterColuna(tipo, linha[nome]);
  return saida;
}
