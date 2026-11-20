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

export function sqlMergeFato(fato: string, staging: string, cfg: Pick<ConfiguracaoFato, 'chave' | 'colunas'>): string {
  const onClause = cfg.chave.map((coluna) => `alvo.${coluna} = origem.${coluna}`).join(' AND ');
  const setClause = cfg.colunas
    .filter((coluna) => !cfg.chave.includes(coluna))
    .map((coluna) => `${coluna} = origem.${coluna}`)
    .join(', ');
  const insertColunas = cfg.colunas.join(', ');
  const insertValores = cfg.colunas.map((coluna) => `origem.${coluna}`).join(', ');
  const quandoExiste = setClause ? `WHEN MATCHED THEN UPDATE SET ${setClause}` : '';

  return `
      MERGE ${fato} AS alvo
      USING (
        SELECT * FROM ${staging} WHERE ${FILTRO_DO_LOTE}
        QUALIFY ROW_NUMBER() OVER (PARTITION BY ${cfg.chave.join(', ')} ORDER BY inserido_em DESC) = 1
      ) AS origem
      ON ${onClause}
      ${quandoExiste}
      WHEN NOT MATCHED THEN INSERT (${insertColunas}) VALUES (${insertValores})
    `;
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
      WHERE d.atual AND ${mesmaChave} AND d.hash_versao != o.hash_versao;

      INSERT INTO ${dimensao} (${colunas.join(', ')}, valido_de, valido_ate, atual, hash_versao, execucao_id, carregado_em)
      SELECT ${colunas.map((coluna) => `o.${coluna}`).join(', ')},
        IF(EXISTS (SELECT 1 FROM ${dimensao} d WHERE ${mesmaChave}), @agora, ${VALIDO_DE_PRIMEIRA_VERSAO}),
        ${VALIDO_ATE_ABERTO}, TRUE, o.hash_versao, @execucaoId, @agora
      FROM (${origem}
      ) AS o
      WHERE NOT EXISTS (SELECT 1 FROM ${dimensao} d WHERE d.atual AND ${mesmaChave});

      COMMIT TRANSACTION;
    `;
}
