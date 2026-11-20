import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { Storage, type Bucket, type File } from '@google-cloud/storage';
import { validarCaminho, validarPrefixo } from './caminhos.ts';
import type {
  ArmazenamentoDeContexto,
  ItemListado,
  MetadadosDeGravacao,
  ObjetoLido,
  OpcoesDeExclusao,
  OpcoesDeGravacao,
  OpcoesDeListagem,
  PaginaListada,
  ResultadoDeGravacao,
} from './tipos.ts';

export type BucketMinimo = Pick<Bucket, 'file' | 'getFiles'>;

const LISTAGEM_PADRAO = 100;
const LISTAGEM_MAXIMA = 1000;
const CONCORRENCIA_DA_EXCLUSAO = 8;

function codigoHttp(erro: unknown): number | undefined {
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === 'number' ? codigo : undefined;
}

function metadadosPersonalizados(meta: MetadadosDeGravacao): Record<string, string> {
  return { ...(meta.metadata ?? {}), ...(meta.sha256 ? { sha256: meta.sha256 } : {}) };
}

function opcoesDeEscrita(meta: MetadadosDeGravacao, opts?: OpcoesDeGravacao) {
  return {
    contentType: meta.contentType,
    resumable: false,
    validation: 'crc32c' as const,
    metadata: { cacheControl: 'private, no-store', metadata: metadadosPersonalizados(meta) },
    ...(opts?.ifGenerationMatch !== undefined
      ? { preconditionOpts: { ifGenerationMatch: Number(opts.ifGenerationMatch) } }
      : {}),
  };
}

async function executarComLimite<T>(itens: T[], limite: number, tarefa: (item: T) => Promise<void>) {
  const fila = [...itens];
  const trabalhadores = Array.from({ length: Math.min(limite, fila.length) }, async () => {
    for (let item = fila.shift(); item !== undefined; item = fila.shift()) {
      await tarefa(item);
    }
  });
  await Promise.all(trabalhadores);
}

function lerGeracao(arquivo: File): string {
  return String(arquivo.metadata.generation ?? '');
}

export class ArmazenamentoGcs implements ArmazenamentoDeContexto {
  readonly disponivel = true;

  private readonly bucket: BucketMinimo;

  constructor(bucket: BucketMinimo) {
    this.bucket = bucket;
  }

  async put(
    path: string,
    body: Buffer | Readable,
    meta: MetadadosDeGravacao,
    opts?: OpcoesDeGravacao,
  ): Promise<ResultadoDeGravacao> {
    validarCaminho(path);
    const arquivo = this.bucket.file(path);
    const escrita = opcoesDeEscrita(meta, opts);

    if (Buffer.isBuffer(body)) {
      await arquivo.save(body, escrita);
    } else {
      await pipeline(body, arquivo.createWriteStream(escrita));
    }

    if (!arquivo.metadata.generation) await arquivo.getMetadata();
    return { generation: lerGeracao(arquivo), size: Number(arquivo.metadata.size ?? 0) };
  }

  async get(path: string): Promise<ObjetoLido | null> {
    validarCaminho(path);
    try {
      const [metadados] = await this.bucket.file(path).getMetadata();
      const geracao = String(metadados.generation ?? '');
      const fixado = this.bucket.file(path, { generation: geracao });
      return {
        stream: fixado.createReadStream({ validation: 'crc32c' }),
        contentType: metadados.contentType ?? 'application/octet-stream',
        size: Number(metadados.size ?? 0),
        generation: geracao,
      };
    } catch (erro) {
      if (codigoHttp(erro) === 404) return null;
      throw erro;
    }
  }

  async list(prefix: string, opts: OpcoesDeListagem = {}): Promise<PaginaListada> {
    validarPrefixo(prefix);
    const maxResults = Math.min(Math.max(opts.maxResults ?? LISTAGEM_PADRAO, 1), LISTAGEM_MAXIMA);
    const [arquivos, proxima] = await this.bucket.getFiles({
      prefix,
      maxResults,
      autoPaginate: false,
      ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
    });
    const items: ItemListado[] = arquivos.map((arquivo) => ({
      path: arquivo.name,
      size: Number(arquivo.metadata.size ?? 0),
      updatedAt: String(arquivo.metadata.updated ?? ''),
      contentType: String(arquivo.metadata.contentType ?? 'application/octet-stream'),
    }));
    const token = (proxima as { pageToken?: string } | null | undefined)?.pageToken;
    return token ? { items, nextPageToken: token } : { items };
  }

  async delete(path: string, opts: OpcoesDeExclusao = {}): Promise<void> {
    validarCaminho(path);
    if (opts.todasAsVersoes) {
      await this.apagarGeracoes(path);
      return;
    }
    await this.bucket.file(path).delete({ ignoreNotFound: true });
  }

  async deletePrefix(prefix: string): Promise<{ deleted: number }> {
    validarPrefixo(prefix, { exigirBarraFinal: true });
    return { deleted: await this.apagarGeracoes(prefix) };
  }

  async saudavel(): Promise<boolean> {
    try {
      await this.bucket.getFiles({ prefix: 'orgs/', maxResults: 1, autoPaginate: false });
      return true;
    } catch {
      return false;
    }
  }

  private async apagarGeracoes(prefixoOuCaminho: string): Promise<number> {
    const [arquivos] = await this.bucket.getFiles({ prefix: prefixoOuCaminho, versions: true, autoPaginate: true });
    const alvos = arquivos.filter(
      (arquivo) => prefixoOuCaminho.endsWith('/') || arquivo.name === prefixoOuCaminho,
    );
    let apagados = 0;
    await executarComLimite(alvos, CONCORRENCIA_DA_EXCLUSAO, async (arquivo) => {
      const geracao = lerGeracao(arquivo);
      const alvo = geracao ? this.bucket.file(arquivo.name, { generation: geracao }) : arquivo;
      await alvo.delete({ ignoreNotFound: true });
      apagados += 1;
    });
    return apagados;
  }
}

export function criarArmazenamentoGcs(nomeDoBucket: string): ArmazenamentoDeContexto {
  const cliente = new Storage();
  return new ArmazenamentoGcs(cliente.bucket(nomeDoBucket));
}
