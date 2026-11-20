export const expressaoDaChave = (colunas: readonly string[], alias = ''): string =>
  `CONCAT(${colunas.map((coluna) => `${alias}${coluna}`).join(", '|', ")})`;

export function sqlAplicarDimensao(tabela: string, colunas: readonly string[], colunasDaChave: readonly string[]): string {
  const mesmaChave = colunasDaChave.map((coluna) => `d.${coluna} = n.${coluna}`).join(' AND ');
  return `
      BEGIN TRANSACTION;

      UPDATE ${tabela}
      SET valido_ate = @agora, atual = FALSE
      WHERE atual AND valido_de < @agora AND ${expressaoDaChave(colunasDaChave)} IN UNNEST(@fechar);

      INSERT INTO ${tabela} (${colunas.join(', ')}, carregado_em)
      SELECT ${colunas.map((coluna) => `n.${coluna}`).join(', ')}, @agora
      FROM UNNEST(@novas) AS n
      WHERE NOT EXISTS (SELECT 1 FROM ${tabela} d WHERE d.sk = n.sk)
        AND NOT (n.atual AND EXISTS (SELECT 1 FROM ${tabela} d WHERE d.atual AND ${mesmaChave}));

      COMMIT TRANSACTION;
    `;
}
