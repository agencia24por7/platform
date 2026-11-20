import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';

export type ConteudoDoObjeto = Uint8Array | ReadableStream<Uint8Array>;

export type MetadadosDoObjeto = {
  readonly contentType: string;
  readonly tamanhoBytes?: number;
  readonly sha256?: string;
  readonly cacheControl?: string;
  readonly metadados?: Readonly<Record<string, string>>;
};

export type ObjetoArmazenado = {
  readonly caminho: string;
  readonly contentType: string;
  readonly tamanhoBytes: number;
  readonly atualizadoEm: Date;
  readonly sha256: string | null;
};

export type ObjetoLido = {
  readonly objeto: ObjetoArmazenado;
  readonly conteudo: ReadableStream<Uint8Array>;
};

export type ArmazenamentoDeContexto = {
  readonly configurado: boolean;
  put(caminho: string, conteudo: ConteudoDoObjeto, meta: MetadadosDoObjeto): Promise<Result<ObjetoArmazenado, Failure>>;
  get(caminho: string): Promise<Result<ObjetoLido, Failure>>;
  list(prefixo: string): Promise<Result<readonly ObjetoArmazenado[], Failure>>;
  delete(caminho: string): Promise<Result<void, Failure>>;
  deletePrefix(prefixo: string): Promise<Result<{ readonly apagados: number }, Failure>>;
  saudavel(): Promise<boolean>;
};

export const MENSAGEM_SEM_ARMAZENAMENTO =
  'O armazenamento de arquivos do contexto não está configurado. O texto do contexto funciona; arquivos e brain ficam desligados.';

export function criarArmazenamentoNulo(): ArmazenamentoDeContexto {
  const indisponivel = failure('unavailable', MENSAGEM_SEM_ARMAZENAMENTO);
  return {
    configurado: false,
    put: async () => err(indisponivel),
    get: async () => err(indisponivel),
    list: async () => ok([]),
    delete: async () => ok(undefined),
    deletePrefix: async () => ok({ apagados: 0 }),
    saudavel: async () => false,
  };
}

export function bytesDeTexto(texto: string): Uint8Array {
  return new TextEncoder().encode(texto);
}
