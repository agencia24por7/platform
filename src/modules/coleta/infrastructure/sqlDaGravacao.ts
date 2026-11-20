import { TABELA_PADRAO, type ConfiguracaoFato, type ConfiguracaoScd2, type LinhaBruta, type TiposDasColunas } from './tabelas/tipos.ts';

export const COLUNA_DA_TABELA = '_tabela';

export const VALIDO_ATE_ABERTO = "TIMESTAMP '9999-12-31 00:00:00+00'";
export const VALIDO_DE_PRIMEIRA_VERSAO = "TIMESTAMP '1970-01-01 00:00:00+00'";

export const LIMITES_DA_INSERCAO = { linhas: 5_000, bytes: 8_000_000 } as const;

export type LimitesDaInsercao = { readonly linhas: number; readonly bytes: number };

export function dividirEmLotes<T>(
  linhas: readonly T[],
  limites: LimitesDaInsercao = LIMITES_DA_INSERCAO,
  tamanhoDe: (linha: T) => number = (linha) => Buffer.byteLength(JSON.stringify(linha)),
): readonly (readonly T[])[] {
  const lotes: T[][] = [];
  let atual: T[] = [];
  let bytes = 0;
  for (const linha of linhas) {
    const tamanho = tamanhoDe(linha);
    if (atual.length > 0 && (atual.length >= limites.linhas || bytes + tamanho > limites.bytes)) {
      lotes.push(atual);
      atual = [];
      bytes = 0;
    }
    atual.push(linha);
    bytes += tamanho;
  }
  if (atual.length > 0) lotes.push(atual);
  return lotes;
}

const FILTRO_DO_LOTE = 'execucao_id = @execucaoId AND inserido_em = @inseridoEm';

export type Agrupamento =
  | { readonly ok: true; readonly grupos: ReadonlyMap<string, readonly LinhaBruta[]> }
  | { readonly ok: false; readonly motivo: string };

export function agruparPorTabela(linhas: readonly LinhaBruta[], conhecidas: readonly string[]): Agrupamento {
  const grupos = new Map<string, LinhaBruta[]>();
  for (const linha of linhas) {
    const { [COLUNA_DA_TABELA]: marcada, ...resto } = linha;
    if (marcada !== undefined && marcada !== null && typeof marcada !== 'string') {
      return { ok: false, motivo: 'tabela_invalida' };
    }
    const nome = typeof marcada === 'string' ? marcada : TABELA_PADRAO;
    if (!conhecidas.includes(nome)) return { ok: false, motivo: `tabela_desconhecida:${nome}` };
    const grupo = grupos.get(nome) ?? [];
    grupo.push(resto);
    grupos.set(nome, grupo);
  }
  return { ok: true, grupos };
}

export function sqlInsercaoPorUnnest(destino: string, colunas: readonly string[]): string {
  const lista = colunas.join(', ');
  return `INSERT INTO ${destino} (${lista})
          SELECT ${lista} FROM UNNEST(@linhas)`;
}

const TIPOS_DE_DATA = ['DATE', 'TIMESTAMP'];

export function colunaDeDataDaChave(cfg: { readonly chave: readonly string[]; readonly tipos?: TiposDasColunas }): string | null {
  if (!cfg.tipos) return null;
  const datas = cfg.chave.filter((coluna) => TIPOS_DE_DATA.includes(cfg.tipos![coluna] ?? ''));
  if (datas.length > 1) throw new Error(`fato_com_varias_datas_na_chave:${datas.join(',')}`);
  return datas[0] ?? null;
}

const filtroDaOrganizacao = (chave: readonly string[], alias: string): string =>
  chave.includes('organization_id') ? ` AND ${alias}.organization_id = @organizationId` : '';

export function sqlMergeFato(
  fato: string,
  staging: string,
  cfg: Pick<ConfiguracaoFato, 'chave' | 'colunas' | 'preservarSeNulo'> & { readonly tipos?: TiposDasColunas },
): string {
  const colunaData = colunaDeDataDaChave(cfg);
  const filtroDaData = colunaData ? ` AND alvo.${colunaData} BETWEEN data_minima AND data_maxima` : '';
  const limitesDaData = colunaData
    ? `
      DECLARE data_minima ${cfg.tipos![colunaData]} DEFAULT (SELECT MIN(${colunaData}) FROM ${staging} WHERE ${FILTRO_DO_LOTE});
      DECLARE data_maxima ${cfg.tipos![colunaData]} DEFAULT (SELECT MAX(${colunaData}) FROM ${staging} WHERE ${FILTRO_DO_LOTE});
`
    : '';
  const onClause = cfg.chave.map((coluna) => `alvo.${coluna} = origem.${coluna}`).join(' AND ');
  const setClause = cfg.colunas
    .filter((coluna) => !cfg.chave.includes(coluna))
    .map((coluna) => (cfg.preservarSeNulo?.includes(coluna) ? `${coluna} = COALESCE(origem.${coluna}, alvo.${coluna})` : `${coluna} = origem.${coluna}`))
    .join(', ');
  const insertColunas = cfg.colunas.join(', ');
  const insertValores = cfg.colunas.map((coluna) => `origem.${coluna}`).join(', ');
  const quandoExiste = setClause ? `WHEN MATCHED THEN UPDATE SET ${setClause}` : '';

  return `${limitesDaData}
      MERGE ${fato} AS alvo
      USING (
        SELECT * FROM ${staging} WHERE ${FILTRO_DO_LOTE}
        QUALIFY ROW_NUMBER() OVER (PARTITION BY ${cfg.chave.join(', ')} ORDER BY inserido_em DESC) = 1
      ) AS origem
      ON ${onClause}${filtroDaOrganizacao(cfg.chave, 'alvo')}${filtroDaData}
      ${quandoExiste}
      WHEN NOT MATCHED THEN INSERT (${insertColunas}) VALUES (${insertValores})${colunaData ? ';' : ''}
    `;
}

export const JANELA_DO_SNAPSHOT_DIAS = 7;

export function sqlMergeSnapshot(
  tabela: string,
  cfg: { readonly chave: readonly string[]; readonly colunas: readonly string[]; readonly colunaMomento: string },
): string {
  const onClause = cfg.chave.map((coluna) => `alvo.${coluna} = origem.${coluna}`).join(' AND ');
  const lista = cfg.colunas.join(', ');
  return `
      MERGE ${tabela} AS alvo
      USING (
        SELECT ${lista} FROM UNNEST(@linhas)
        WHERE TRUE
        QUALIFY ROW_NUMBER() OVER (PARTITION BY ${cfg.chave.join(', ')} ORDER BY ${cfg.colunaMomento} DESC) = 1
      ) AS origem
      ON ${onClause}${filtroDaOrganizacao(cfg.chave, 'alvo')}
        AND alvo.${cfg.colunaMomento} >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${JANELA_DO_SNAPSHOT_DIAS} DAY)
      WHEN NOT MATCHED THEN INSERT (${lista}) VALUES (${cfg.colunas.map((coluna) => `origem.${coluna}`).join(', ')})
    `;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(valor: unknown): boolean {
  if (valor instanceof Date) return !Number.isNaN(valor.getTime());
  if (typeof valor !== 'string' || !DATA_ISO.test(valor)) return false;
  const data = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(valor);
}

function momentoValido(valor: unknown): boolean {
  if (valor instanceof Date) return !Number.isNaN(valor.getTime());
  return typeof valor === 'string' && valor.trim() !== '' && !Number.isNaN(Date.parse(valor));
}

export function valorDeChaveValido(valor: unknown, tipo: string | undefined): boolean {
  if (valor === null || valor === undefined) return false;
  if (tipo === 'DATE') return dataValida(valor);
  if (tipo === 'TIMESTAMP') return momentoValido(valor);
  if (tipo === 'INT64') return (typeof valor === 'number' && Number.isInteger(valor)) || (typeof valor === 'string' && /^-?\d+$/.test(valor));
  if (tipo === 'BOOL') return typeof valor === 'boolean';
  if (tipo === 'STRING') return typeof valor === 'string' || (typeof valor === 'number' && Number.isFinite(valor));
  return true;
}

export function separarPorChaveValida<T extends Readonly<Record<string, unknown>>>(
  linhas: readonly T[],
  chave: readonly string[],
  tipos: TiposDasColunas,
): { readonly validas: readonly T[]; readonly descartadas: number } {
  const validas = linhas.filter((linha) => chave.every((coluna) => valorDeChaveValido(linha[coluna], tipos[coluna])));
  return { validas, descartadas: linhas.length - validas.length };
}

export function colunasDoStagingScd2(cfg: Pick<ConfiguracaoScd2, 'chave' | 'atributos'>): readonly string[] {
  return [...cfg.chave, ...cfg.atributos, 'execucao_id', 'inserido_em'];
}

export function tiposDoStagingScd2(cfg: Pick<ConfiguracaoScd2, 'chave' | 'atributos' | 'tipos'>): TiposDasColunas {
  const declaradas = [...cfg.chave, ...cfg.atributos];
  const faltando = declaradas.filter((coluna) => !cfg.tipos[coluna]);
  if (faltando.length > 0) throw new Error(`scd2_sem_tipo:${faltando.join(',')}`);
  return {
    ...Object.fromEntries(declaradas.map((coluna) => [coluna, cfg.tipos[coluna]!])),
    execucao_id: 'STRING',
    inserido_em: 'TIMESTAMP',
  };
}

export function sqlHashDosAtributos(atributos: readonly string[], alias = ''): string {
  return `TO_HEX(SHA256(TO_JSON_STRING(STRUCT(${atributos.map((coluna) => `${alias}${coluna} AS ${coluna}`).join(', ')}))))`;
}

export function sqlScd2(dimensao: string, staging: string, cfg: Pick<ConfiguracaoScd2, 'chave' | 'atributos'>): string {
  const colunas = [...cfg.chave, ...cfg.atributos];
  const mesmaChave = cfg.chave.map((coluna) => `d.${coluna} = o.${coluna}`).join(' AND ');
  const daOrganizacao = filtroDaOrganizacao(cfg.chave, 'd');
  const origem = `
        SELECT ${colunas.join(', ')}, ${sqlHashDosAtributos(cfg.atributos)} AS hash_versao
        FROM ${staging}
        WHERE ${FILTRO_DO_LOTE}
        QUALIFY ROW_NUMBER() OVER (PARTITION BY ${cfg.chave.join(', ')} ORDER BY inserido_em DESC) = 1`;

  return `
      BEGIN TRANSACTION;

      UPDATE ${dimensao} AS d
      SET valido_ate = @agora, atual = FALSE
      FROM (${origem}
      ) AS o
      WHERE d.atual AND ${mesmaChave}${daOrganizacao} AND d.hash_versao != o.hash_versao;

      INSERT INTO ${dimensao} (${colunas.join(', ')}, valido_de, valido_ate, atual, hash_versao, execucao_id, carregado_em)
      SELECT ${colunas.map((coluna) => `o.${coluna}`).join(', ')},
        IF(EXISTS (SELECT 1 FROM ${dimensao} d WHERE ${mesmaChave}${daOrganizacao}), @agora, ${VALIDO_DE_PRIMEIRA_VERSAO}),
        ${VALIDO_ATE_ABERTO}, TRUE, o.hash_versao, @execucaoId, @agora
      FROM (${origem}
      ) AS o
      WHERE NOT EXISTS (SELECT 1 FROM ${dimensao} d WHERE d.atual AND ${mesmaChave}${daOrganizacao});

      COMMIT TRANSACTION;
    `;
}
