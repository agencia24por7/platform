import { BigQuery } from '@google-cloud/bigquery';

export type TiposBigQuery = Readonly<Record<string, string>>;

export function paraParametroBigQuery(valor: unknown, tipo: string | undefined): unknown {
  if (valor === null || valor === undefined) return null;
  if (tipo === 'DATE') return BigQuery.date(String(valor));
  if (tipo === 'TIMESTAMP') return BigQuery.timestamp(valor instanceof Date ? valor : String(valor));
  return valor;
}

export function linhaParaBigQuery(linha: Readonly<Record<string, unknown>>, tipos: TiposBigQuery): Record<string, unknown> {
  return Object.fromEntries(Object.keys(tipos).map((coluna) => [coluna, paraParametroBigQuery(linha[coluna], tipos[coluna])]));
}
