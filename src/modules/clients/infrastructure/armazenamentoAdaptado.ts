import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import {
  ArmazenamentoIndisponivelError,
  CaminhoInvalidoError,
  type ArmazenamentoDeContexto,
} from '@/shared/storage/tipos';
import {
  MENSAGEM_SEM_ARMAZENAMENTO,
  type ObjetoArmazenado,
  type PortaDoArmazenamento,
} from '@/modules/clients/application/portaDoArmazenamento';

const MAX_PAGINAS = 1000;

function traduzir(erro: unknown): Failure {
  if (erro instanceof ArmazenamentoIndisponivelError) return failure('unavailable', MENSAGEM_SEM_ARMAZENAMENTO);
  if (erro instanceof CaminhoInvalidoError) return failure('validation', erro.message);
  const mensagem = erro instanceof Error ? erro.message : 'falha desconhecida';
  return failure('unavailable', `Falha no armazenamento: ${mensagem.slice(0, 200)}`);
}

async function tentar<T>(operacao: () => Promise<T>): Promise<Result<T, Failure>> {
  try {
    return ok(await operacao());
  } catch (erro) {
    return err(traduzir(erro));
  }
}

export function adaptarArmazenamento(base: ArmazenamentoDeContexto): PortaDoArmazenamento {
  return {
    configurado: base.disponivel,

    put: (caminho, conteudo, meta) =>
      tentar(async (): Promise<ObjetoArmazenado> => {
        const corpo = conteudo instanceof Uint8Array ? Buffer.from(conteudo.buffer, conteudo.byteOffset, conteudo.byteLength) : conteudo;
        const gravado = await base.put(caminho, corpo, {
          contentType: meta.contentType,
          ...(meta.sha256 ? { sha256: meta.sha256 } : {}),
          ...(meta.metadados ? { metadata: { ...meta.metadados } } : {}),
        });
        return { caminho, contentType: meta.contentType, tamanhoBytes: gravado.size, atualizadoEm: null };
      }),

    get: (caminho) =>
      tentar(async () => {
        const lido = await base.get(caminho);
        if (!lido) return null;
        return {
          objeto: { caminho, contentType: lido.contentType, tamanhoBytes: lido.size, atualizadoEm: null },
          conteudo: lido.stream,
        };
      }),

    list: (prefixo) =>
      tentar(async () => {
        const objetos: ObjetoArmazenado[] = [];
        let pagina: string | undefined;
        for (let i = 0; i < MAX_PAGINAS; i++) {
          const resultado = await base.list(prefixo, pagina ? { pageToken: pagina, maxResults: 1000 } : { maxResults: 1000 });
          for (const item of resultado.items) {
            objetos.push({
              caminho: item.path,
              contentType: item.contentType,
              tamanhoBytes: item.size,
              atualizadoEm: item.updatedAt ? new Date(item.updatedAt) : null,
            });
          }
          pagina = resultado.nextPageToken;
          if (!pagina) break;
        }
        return objetos;
      }),

    delete: (caminho, opcoes) => tentar(() => base.delete(caminho, opcoes?.todasAsVersoes ? { todasAsVersoes: true } : {})),

    deletePrefix: (prefixo) =>
      tentar(async () => {
        const resultado = await base.deletePrefix(prefixo);
        return { apagados: resultado.deleted };
      }),

    saudavel: () => base.saudavel().catch(() => false),
  };
}
