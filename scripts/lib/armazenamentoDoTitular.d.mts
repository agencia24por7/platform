export type Etapa =
  | 'armazenamento'
  | 'bigquery'
  | 'bigquery_por_client_id'
  | 'dimensoes'
  | 'dimensoes_obrigatoria'
  | 'postgres';

export type ModoDoArmazenamento = 'tudo' | 'derivados';

export type ResultadoDoArmazenamento =
  | { readonly ok: true; readonly apagados: number; readonly alvo: string | null; readonly desativado: boolean }
  | { readonly ok: false; readonly erro: string };

export const ROTA_DO_EXPURGO_DO_ARMAZENAMENTO: string;
export const MODOS_DO_ARMAZENAMENTO: readonly ModoDoArmazenamento[];

export function etapasDoExpurgo(opcoes: {
  readonly existe: boolean;
  readonly local: boolean;
  readonly somenteArmazenamento?: boolean;
}): Etapa[];

export function expurgarArmazenamento(opcoes: {
  readonly base: string;
  readonly token: string;
  readonly organizationId: string | null | undefined;
  readonly clientId: string;
  readonly modo: ModoDoArmazenamento;
  readonly local: boolean;
  readonly buscar?: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<ResultadoDoArmazenamento>;
