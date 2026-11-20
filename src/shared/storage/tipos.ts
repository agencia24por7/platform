import type { Readable } from 'node:stream';

export type MetadadosDeGravacao = {
  contentType: string;
  sha256?: string;
  metadata?: Record<string, string>;
};

export type OpcoesDeGravacao = {
  ifGenerationMatch?: string | number;
};

export type ResultadoDeGravacao = {
  generation: string;
  size: number;
};

export type ObjetoLido = {
  stream: Readable;
  contentType: string;
  size: number;
  generation: string;
};

export type ItemListado = {
  path: string;
  size: number;
  updatedAt: string;
  contentType: string;
};

export type OpcoesDeListagem = {
  maxResults?: number;
  pageToken?: string;
};

export type PaginaListada = {
  items: ItemListado[];
  nextPageToken?: string;
};

export type OpcoesDeExclusao = {
  todasAsVersoes?: boolean;
};

export interface ArmazenamentoDeContexto {
  readonly disponivel: boolean;
  put(
    path: string,
    body: Buffer | Readable,
    meta: MetadadosDeGravacao,
    opts?: OpcoesDeGravacao,
  ): Promise<ResultadoDeGravacao>;
  get(path: string): Promise<ObjetoLido | null>;
  list(prefix: string, opts?: OpcoesDeListagem): Promise<PaginaListada>;
  delete(path: string, opts?: OpcoesDeExclusao): Promise<void>;
  deletePrefix(prefix: string): Promise<{ deleted: number }>;
  saudavel(): Promise<boolean>;
}

export class ArmazenamentoIndisponivelError extends Error {
  readonly codigo = 'indisponivel' as const;

  constructor() {
    super('Armazenamento do contexto não configurado (CONTEXT_BUCKET ausente).');
    this.name = 'ArmazenamentoIndisponivelError';
  }
}

export class CaminhoInvalidoError extends Error {
  readonly codigo = 'caminho_invalido' as const;

  constructor(motivo: string) {
    super(`Caminho de armazenamento inválido: ${motivo}`);
    this.name = 'CaminhoInvalidoError';
  }
}
