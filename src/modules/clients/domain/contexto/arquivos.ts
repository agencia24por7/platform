import type { CategoriaDeArquivo } from './catalogo.ts';

export const MB = 1024 * 1024;
export const TAMANHO_MAXIMO_DO_ARQUIVO = 25 * MB;
export const COTA_POR_CLIENTE = 500 * MB;
const MAX_NOME = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TipoPermitido = {
  readonly mime: string;
  readonly extensoes: readonly string[];
  readonly categoria: CategoriaDeArquivo;
  readonly assinatura: 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'ooxml' | 'isobmff' | 'texto';
};

export const TIPOS_PERMITIDOS: readonly TipoPermitido[] = [
  { mime: 'image/png', extensoes: ['png'], categoria: 'imagem', assinatura: 'png' },
  { mime: 'image/jpeg', extensoes: ['jpg', 'jpeg'], categoria: 'imagem', assinatura: 'jpeg' },
  { mime: 'image/webp', extensoes: ['webp'], categoria: 'imagem', assinatura: 'webp' },
  { mime: 'image/gif', extensoes: ['gif'], categoria: 'imagem', assinatura: 'gif' },
  { mime: 'application/pdf', extensoes: ['pdf'], categoria: 'documento', assinatura: 'pdf' },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensoes: ['docx'],
    categoria: 'documento',
    assinatura: 'ooxml',
  },
  { mime: 'text/plain', extensoes: ['txt'], categoria: 'documento', assinatura: 'texto' },
  { mime: 'text/csv', extensoes: ['csv'], categoria: 'planilha', assinatura: 'texto' },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensoes: ['xlsx'],
    categoria: 'planilha',
    assinatura: 'ooxml',
  },
  { mime: 'video/mp4', extensoes: ['mp4'], categoria: 'video', assinatura: 'isobmff' },
  { mime: 'video/quicktime', extensoes: ['mov'], categoria: 'video', assinatura: 'isobmff' },
];

export type MotivoDoArquivo =
  | 'tipo_nao_permitido'
  | 'extensao_divergente'
  | 'categoria_nao_aceita'
  | 'vazio'
  | 'grande_demais'
  | 'cota_excedida'
  | 'assinatura_divergente';

export const MOTIVO_DO_ARQUIVO: Record<MotivoDoArquivo, string> = {
  tipo_nao_permitido: 'Esse tipo de arquivo não é aceito. Envie imagem (PNG, JPG, WEBP, GIF), PDF, DOCX, TXT, CSV, XLSX ou vídeo MP4/MOV.',
  extensao_divergente: 'A extensão do arquivo não combina com o tipo dele.',
  categoria_nao_aceita: 'Este campo não aceita esse tipo de arquivo.',
  vazio: 'O arquivo está vazio.',
  grande_demais: `O arquivo passa de ${TAMANHO_MAXIMO_DO_ARQUIVO / MB} MB. Para arquivos maiores, envie um link.`,
  cota_excedida: `O cliente já usa o limite de ${COTA_POR_CLIENTE / MB} MB de arquivos. Remova algum antes de enviar outro.`,
  assinatura_divergente: 'O conteúdo do arquivo não corresponde ao tipo informado.',
};

export type PedidoDeArquivo = {
  readonly nome: string;
  readonly mime: string;
  readonly tamanhoBytes: number;
  readonly categoriasAceitas: readonly CategoriaDeArquivo[];
  readonly usoAtualDoClienteBytes: number;
};

export type ArquivoAvaliado =
  | { readonly ok: true; readonly tipo: TipoPermitido }
  | { readonly ok: false; readonly motivo: MotivoDoArquivo };

function extensao(nome: string): string {
  const partes = nome.toLowerCase().split('.');
  return partes.length > 1 ? (partes[partes.length - 1] ?? '') : '';
}

export function avaliarArquivo(pedido: PedidoDeArquivo): ArquivoAvaliado {
  const mime = pedido.mime.toLowerCase().split(';')[0]?.trim() ?? '';
  const tipo = TIPOS_PERMITIDOS.find((candidato) => candidato.mime === mime);
  if (!tipo) return { ok: false, motivo: 'tipo_nao_permitido' };
  if (!tipo.extensoes.includes(extensao(pedido.nome))) return { ok: false, motivo: 'extensao_divergente' };
  if (!pedido.categoriasAceitas.includes(tipo.categoria)) return { ok: false, motivo: 'categoria_nao_aceita' };
  if (pedido.tamanhoBytes <= 0) return { ok: false, motivo: 'vazio' };
  if (pedido.tamanhoBytes > TAMANHO_MAXIMO_DO_ARQUIVO) return { ok: false, motivo: 'grande_demais' };
  if (pedido.usoAtualDoClienteBytes + pedido.tamanhoBytes > COTA_POR_CLIENTE) {
    return { ok: false, motivo: 'cota_excedida' };
  }
  return { ok: true, tipo };
}

function comeca(bytes: Uint8Array, assinatura: readonly number[], deslocamento = 0): boolean {
  return assinatura.every((byte, i) => bytes[deslocamento + i] === byte);
}

const ascii = (texto: string): readonly number[] => [...texto].map((c) => c.charCodeAt(0));

export function assinaturaConfere(tipo: TipoPermitido, inicio: Uint8Array): boolean {
  switch (tipo.assinatura) {
    case 'png':
      return comeca(inicio, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg':
      return comeca(inicio, [0xff, 0xd8, 0xff]);
    case 'gif':
      return comeca(inicio, ascii('GIF87a')) || comeca(inicio, ascii('GIF89a'));
    case 'webp':
      return comeca(inicio, ascii('RIFF')) && comeca(inicio, ascii('WEBP'), 8);
    case 'pdf':
      return comeca(inicio, ascii('%PDF-'));
    case 'ooxml':
      return comeca(inicio, [0x50, 0x4b, 0x03, 0x04]);
    case 'isobmff':
      return comeca(inicio, ascii('ftyp'), 4);
    case 'texto':
      return inicio.length > 0 && !inicio.includes(0) && !comeca(inicio, ascii('<'));
  }
}

export function nomeSeguro(nome: string): string {
  const ext = extensao(nome);
  const base = (ext ? nome.slice(0, -(ext.length + 1)) : nome)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  const extLimpa = ext.replace(/[^a-z0-9]/g, '');
  const corpo = (base || 'arquivo').slice(0, MAX_NOME - extLimpa.length - 1).replace(/[-.]+$/g, '') || 'arquivo';
  return extLimpa ? `${corpo}.${extLimpa}` : corpo;
}

function exigirUuid(valor: string, nome: string): string {
  if (!UUID.test(valor)) throw new Error(`${nome} precisa ser um uuid para montar o caminho no armazenamento.`);
  return valor.toLowerCase();
}

export function prefixoDoCliente(organizationId: string, clientId: string): string {
  return `orgs/${exigirUuid(organizationId, 'organizationId')}/clientes/${exigirUuid(clientId, 'clientId')}/`;
}

export function prefixoDoContexto(organizationId: string, clientId: string): string {
  return `${prefixoDoCliente(organizationId, clientId)}contexto/`;
}

export function prefixoDoBrain(organizationId: string, clientId: string): string {
  return `${prefixoDoContexto(organizationId, clientId)}brain/`;
}

export function prefixoDosArquivos(organizationId: string, clientId: string): string {
  return `${prefixoDoContexto(organizationId, clientId)}arquivos/`;
}

export function caminhoDoArquivo(organizationId: string, clientId: string, fileId: string, nome: string): string {
  return `${prefixoDosArquivos(organizationId, clientId)}${exigirUuid(fileId, 'fileId')}-${nomeSeguro(nome)}`;
}

export function caminhoPertenceAoCliente(caminho: string, organizationId: string, clientId: string): boolean {
  return caminho.startsWith(prefixoDoCliente(organizationId, clientId)) && !caminho.includes('..');
}
