import { MAXIMO_DE_CAMPANHAS, MAXIMO_DE_FATIAS, MOEDA_MISTA, PLATAFORMAS_DE_DESEMPENHO, type EscopoMedido, type RecorteDeDesempenho } from '../domain/desempenho.ts';
import { qualificada, type Destino } from './sqlDaCobertura.ts';

export type ConsultaDeDesempenho = { readonly nome: string; readonly sql: string; readonly escopos: readonly EscopoMedido[] };

export const PARAMETROS_DO_DESEMPENHO = ['organizacao', 'cliente_id', 'inicio_serie', 'fim_serie', 'inicio_janela'] as const;

export type EspecificacaoDeRecorte = {
  readonly plataforma: (typeof PLATAFORMAS_DE_DESEMPENHO)[number];
  readonly recorte: Exclude<RecorteDeDesempenho, 'total' | 'campanha'>;
  readonly view: string;
  readonly colunasDaChave: readonly string[];
  readonly conversoes: string;
  readonly receita: string;
};

export const RECORTES_POR_PLATAFORMA: readonly EspecificacaoDeRecorte[] = [
  { plataforma: 'meta', recorte: 'idade_genero', view: 'vw_meta_recorte_idade_genero', colunasDaChave: ['idade', 'genero'], conversoes: 'compras', receita: 'receita_compras' },
  { plataforma: 'meta', recorte: 'regiao', view: 'vw_meta_recorte_regiao', colunasDaChave: ['regiao'], conversoes: 'compras', receita: 'receita_compras' },
  {
    plataforma: 'meta', recorte: 'posicionamento', view: 'vw_meta_recorte_posicionamento',
    colunasDaChave: ['plataforma_publicacao', 'posicao_plataforma'], conversoes: 'compras', receita: 'receita_compras',
  },
  { plataforma: 'google', recorte: 'dispositivo', view: 'vw_google_dispositivo_diario', colunasDaChave: ['dispositivo'], conversoes: 'conversoes', receita: 'receita' },
];

const IDENTIFICADOR = /^[a-z][a-z0-9_]*$/;
const exigir = (nome: string): string => {
  if (!IDENTIFICADOR.test(nome)) throw new Error(`identificador inválido para o BigQuery: ${nome}`);
  return nome;
};

const texto = (coluna: string): string => `IFNULL(NULLIF(TRIM(CAST(${exigir(coluna)} AS STRING)), ''), 'n/d')`;

function listaDePlataformas(plataformas: readonly string[]): string {
  const validas = PLATAFORMAS_DE_DESEMPENHO.filter((p) => plataformas.includes(p));
  if (validas.length === 0) throw new Error('nenhuma plataforma de anúncio para medir');
  return validas.map((p) => `'${p}'`).join(', ');
}

function escoposDe(plataformas: readonly string[], recorte: RecorteDeDesempenho): EscopoMedido[] {
  return PLATAFORMAS_DE_DESEMPENHO.filter((p) => plataformas.includes(p)).map((platform) => ({ platform, recorte }));
}

function agregados(conversoes: string, receita: string): string {
  return `CAST(ROUND(SUM(IFNULL(investimento, 0)) * 100) AS INT64) AS investimento_centavos,
    SUM(IFNULL(impressoes, 0)) AS impressoes,
    SUM(IFNULL(cliques, 0)) AS cliques,
    CAST(SUM(IFNULL(${exigir(conversoes)}, 0)) AS FLOAT64) AS conversoes,
    CAST(ROUND(NULLIF(SUM(IFNULL(${exigir(receita)}, 0)), 0) * 100) AS INT64) AS receita_centavos,
    IF(COUNT(DISTINCT moeda) = 1, MAX(moeda), '${MOEDA_MISTA}') AS moeda`;
}

const DONO = 'organization_id = @organizacao AND cliente_atual_id = @cliente_id';
const SERIE = 'data_dia >= @inicio_serie AND data_dia < @fim_serie';
const JANELA = 'data_dia >= @inicio_janela AND data_dia < @fim_serie';
const COLUNAS_FINAIS = 'investimento_centavos, impressoes, cliques, conversoes, receita_centavos, moeda';

export function sqlDoTotal(destino: Destino, plataformas: readonly string[]): ConsultaDeDesempenho {
  return {
    nome: 'total',
    escopos: escoposDe(plataformas, 'total'),
    sql: `SELECT platform, DATE_TRUNC(data_dia, MONTH) AS periodo, 'total' AS recorte, '' AS chave, 'Total' AS rotulo,
    ${agregados('conversoes', 'receita')}
FROM ${qualificada(destino, 'vw_ads_diario')}
WHERE ${DONO} AND ${SERIE} AND platform IN (${listaDePlataformas(plataformas)})
GROUP BY platform, periodo`,
  };
}

export function sqlDeCampanhas(destino: Destino, plataformas: readonly string[]): ConsultaDeDesempenho {
  return {
    nome: 'campanha',
    escopos: escoposDe(plataformas, 'campanha'),
    sql: `WITH agregado AS (
  SELECT platform, external_campaign_id AS chave,
    LEFT(IFNULL(NULLIF(TRIM(MAX_BY(campaign_name, data_dia)), ''), external_campaign_id), 200) AS rotulo,
    ${agregados('conversoes', 'receita')}
  FROM ${qualificada(destino, 'vw_ads_diario')}
  WHERE ${DONO} AND ${JANELA} AND platform IN (${listaDePlataformas(plataformas)})
  GROUP BY platform, chave
)
SELECT platform, @inicio_janela AS periodo, 'campanha' AS recorte, LEFT(chave, 200) AS chave, rotulo, ${COLUNAS_FINAIS}
FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY platform ORDER BY investimento_centavos DESC, chave) AS posicao FROM agregado)
WHERE posicao <= ${MAXIMO_DE_CAMPANHAS}`,
  };
}

export function sqlDoRecorte(destino: Destino, especificacao: EspecificacaoDeRecorte): ConsultaDeDesempenho {
  const partes = especificacao.colunasDaChave.map(texto);
  const chave = partes.length === 1 ? partes[0]! : `CONCAT(${partes.join(", '|', ")})`;
  const rotulo = partes.length === 1 ? partes[0]! : `CONCAT(${partes.join(", ' · ', ")})`;
  return {
    nome: `${especificacao.plataforma}:${especificacao.recorte}`,
    escopos: [{ platform: especificacao.plataforma, recorte: especificacao.recorte }],
    sql: `WITH agregado AS (
  SELECT LEFT(${chave}, 200) AS chave, LEFT(${rotulo}, 200) AS rotulo,
    ${agregados(especificacao.conversoes, especificacao.receita)}
  FROM ${qualificada(destino, especificacao.view)}
  WHERE ${DONO} AND ${JANELA}
  GROUP BY chave, rotulo
)
SELECT '${especificacao.plataforma}' AS platform, @inicio_janela AS periodo, '${especificacao.recorte}' AS recorte, chave, rotulo, ${COLUNAS_FINAIS}
FROM (SELECT *, ROW_NUMBER() OVER (ORDER BY investimento_centavos DESC, chave) AS posicao FROM agregado)
WHERE posicao <= ${MAXIMO_DE_FATIAS}`,
  };
}

export function consultasDeDesempenho(destino: Destino, plataformas: readonly string[]): readonly ConsultaDeDesempenho[] {
  return [
    sqlDoTotal(destino, plataformas),
    sqlDeCampanhas(destino, plataformas),
    ...RECORTES_POR_PLATAFORMA.filter((r) => plataformas.includes(r.plataforma)).map((r) => sqlDoRecorte(destino, r)),
  ];
}
