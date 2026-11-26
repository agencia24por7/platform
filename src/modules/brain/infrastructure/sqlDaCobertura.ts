import type { ObjetoDeMedicao } from '../application/portas.ts';

const IDENTIFICADOR = /^[a-z][a-z0-9_]*$/;
export const TABELA_DE_COBERTURA = 'gov_cobertura_cliente';

export type Destino = { readonly projeto: string; readonly conjuntoDeDados: string };

export const TIPOS_DA_COBERTURA = {
  organization_id: 'STRING',
  client_id: 'STRING',
  tabela: 'STRING',
  desde: 'DATE',
  ate: 'DATE',
  linhas: 'INT64',
  dias_com_dado: 'INT64',
  medido_em: 'TIMESTAMP',
} as const;

function exigir(nome: string): string {
  if (!IDENTIFICADOR.test(nome)) throw new Error(`identificador inválido para o BigQuery: ${nome}`);
  return nome;
}

export function qualificada(destino: Destino, objeto: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(destino.projeto) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(destino.conjuntoDeDados)) {
    throw new Error('projeto ou conjunto de dados inválido');
  }
  return `\`${destino.projeto}.${destino.conjuntoDeDados}.${exigir(objeto)}\``;
}

function parte(destino: Destino, objeto: ObjetoDeMedicao): string {
  const view = qualificada(destino, objeto.view);
  const tabela = `'${exigir(objeto.tabela)}'`;
  if (objeto.dimensao || !objeto.colunaDeData) {
    return `SELECT ${tabela} AS tabela, DATE(MIN(valido_de)) AS desde, DATE(MAX(valido_de)) AS ate, COUNTIF(atual) AS linhas, CAST(NULL AS INT64) AS dias_com_dado
FROM ${view} WHERE cliente_atual_id = @cliente_id`;
  }
  const data = exigir(objeto.colunaDeData);
  return `SELECT ${tabela} AS tabela, MIN(${data}) AS desde, MAX(${data}) AS ate, COUNT(*) AS linhas, COUNT(DISTINCT ${data}) AS dias_com_dado
FROM ${view} WHERE cliente_atual_id = @cliente_id AND ${data} BETWEEN @desde AND @ate`;
}

export function sqlDaMedicao(destino: Destino, objetos: readonly ObjetoDeMedicao[]): string {
  if (objetos.length === 0) throw new Error('nada para medir');
  const ordenados = [...objetos].sort((a, b) => a.tabela.localeCompare(b.tabela));
  return ordenados.map((objeto) => parte(destino, objeto)).join('\nUNION ALL\n');
}

export function sqlDoMergeDaCobertura(destino: Destino): string {
  const alvo = qualificada(destino, TABELA_DE_COBERTURA);
  return `MERGE ${alvo} t
USING (SELECT * FROM UNNEST(@linhas)) s
ON t.organization_id = s.organization_id AND t.client_id = s.client_id AND t.tabela = s.tabela
WHEN MATCHED THEN UPDATE SET desde = s.desde, ate = s.ate, linhas = s.linhas, dias_com_dado = s.dias_com_dado, medido_em = s.medido_em
WHEN NOT MATCHED THEN INSERT (organization_id, client_id, tabela, desde, ate, linhas, dias_com_dado, medido_em)
  VALUES (s.organization_id, s.client_id, s.tabela, s.desde, s.ate, s.linhas, s.dias_com_dado, s.medido_em)`;
}
