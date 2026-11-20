import type { Readable } from 'node:stream';
import type { Failure } from '@/shared/result/failure';
import type { Result } from '@/shared/result/result';

export type ConteudoDoObjeto = Uint8Array | Readable;

export type MetadadosDoObjeto = {
  readonly contentType: string;
  readonly sha256?: string;
  readonly metadados?: Readonly<Record<string, string>>;
};

export type ObjetoArmazenado = {
  readonly caminho: string;
  readonly contentType: string;
  readonly tamanhoBytes: number;
  readonly atualizadoEm: Date | null;
};

export type ObjetoLido = {
  readonly objeto: ObjetoArmazenado;
  readonly conteudo: Readable;
};

export type PortaDoArmazenamento = {
  readonly configurado: boolean;
  put(caminho: string, conteudo: ConteudoDoObjeto, meta: MetadadosDoObjeto): Promise<Result<ObjetoArmazenado, Failure>>;
  get(caminho: string): Promise<Result<ObjetoLido | null, Failure>>;
  list(prefixo: string): Promise<Result<readonly ObjetoArmazenado[], Failure>>;
  delete(caminho: string, opcoes?: { readonly todasAsVersoes?: boolean }): Promise<Result<void, Failure>>;
  deletePrefix(prefixo: string): Promise<Result<{ readonly apagados: number }, Failure>>;
  saudavel(): Promise<boolean>;
};

export const MENSAGEM_SEM_ARMAZENAMENTO =
  'O armazenamento de arquivos do contexto está desativado (CONTEXT_BUCKET ausente). O texto do contexto funciona; arquivos e brain ficam desligados.';
