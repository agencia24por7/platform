import {
  COTA_POR_CLIENTE_BYTES,
  TAMANHO_MAXIMO_DO_ARQUIVO_BYTES,
  avaliarArquivo,
  type MotivoDeRecusa,
  type TipoPermitido,
} from '../../../../shared/storage/politicaDeArquivos.ts';
import { caminhoDoArquivo, caminhoDoContexto, prefixoDoCliente } from '../../../../shared/storage/caminhos.ts';
import type { CategoriaDeArquivo } from './catalogo.ts';

export { caminhoDoArquivo, prefixoDoCliente };

export const TAMANHO_MAXIMO_DO_ARQUIVO = TAMANHO_MAXIMO_DO_ARQUIVO_BYTES;
export const COTA_POR_CLIENTE = COTA_POR_CLIENTE_BYTES;

export const CATEGORIA_DO_TIPO: Readonly<Record<TipoPermitido, CategoriaDeArquivo>> = {
  png: 'imagem',
  jpeg: 'imagem',
  webp: 'imagem',
  gif: 'imagem',
  pdf: 'documento',
  docx: 'documento',
  txt: 'documento',
  csv: 'planilha',
  xlsx: 'planilha',
  mp4: 'video',
  mov: 'video',
  ttf: 'fonte',
  otf: 'fonte',
  woff2: 'fonte',
};

export type MotivoDoAnexo = MotivoDeRecusa | 'categoria_nao_aceita';

export type PedidoDeAnexo = {
  readonly nome: string;
  readonly mime: string;
  readonly conteudo: Uint8Array;
  readonly categoriasAceitas: readonly CategoriaDeArquivo[];
  readonly usoAtualDoClienteBytes: number;
};

export type AnexoAvaliado =
  | { readonly ok: true; readonly tipo: TipoPermitido; readonly contentType: string; readonly nomeSeguro: string }
  | { readonly ok: false; readonly motivo: MotivoDoAnexo; readonly mensagem: string };

export function avaliarAnexo(pedido: PedidoDeAnexo): AnexoAvaliado {
  const avaliado = avaliarArquivo({
    nome: pedido.nome,
    contentTypeDeclarado: pedido.mime,
    tamanhoBytes: pedido.conteudo.byteLength,
    amostra: pedido.conteudo.subarray(0, 65_536),
    usoAtualDoClienteBytes: pedido.usoAtualDoClienteBytes,
  });
  if (!avaliado.ok) return avaliado;
  if (!pedido.categoriasAceitas.includes(CATEGORIA_DO_TIPO[avaliado.tipo])) {
    return { ok: false, motivo: 'categoria_nao_aceita', mensagem: 'Este campo não aceita esse tipo de arquivo.' };
  }
  return avaliado;
}

export function caminhoDoBrain(organizationId: string, clientId: string, nome: string): string {
  return caminhoDoContexto(organizationId, clientId, 'brain', nome);
}
