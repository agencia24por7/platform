import { nomeSeguro } from './caminhos.ts';

export const TAMANHO_MAXIMO_DO_ARQUIVO_BYTES = 25 * 1024 * 1024;
export const COTA_POR_CLIENTE_BYTES = 500 * 1024 * 1024;
export const BYTES_NECESSARIOS_PARA_IDENTIFICAR = 65_536;

export type TipoPermitido =
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'gif'
  | 'pdf'
  | 'csv'
  | 'txt'
  | 'xlsx'
  | 'docx'
  | 'zip'
  | 'ttf'
  | 'otf'
  | 'woff2';

type DefinicaoDeTipo = {
  contentType: string;
  extensoes: string[];
  contentTypesAceitos: string[];
};

export const TIPOS_PERMITIDOS: Record<TipoPermitido, DefinicaoDeTipo> = {
  png: { contentType: 'image/png', extensoes: ['png'], contentTypesAceitos: ['image/png'] },
  jpeg: { contentType: 'image/jpeg', extensoes: ['jpg', 'jpeg'], contentTypesAceitos: ['image/jpeg', 'image/pjpeg'] },
  webp: { contentType: 'image/webp', extensoes: ['webp'], contentTypesAceitos: ['image/webp'] },
  gif: { contentType: 'image/gif', extensoes: ['gif'], contentTypesAceitos: ['image/gif'] },
  pdf: { contentType: 'application/pdf', extensoes: ['pdf'], contentTypesAceitos: ['application/pdf'] },
  csv: {
    contentType: 'text/csv',
    extensoes: ['csv'],
    contentTypesAceitos: ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel'],
  },
  txt: { contentType: 'text/plain', extensoes: ['txt'], contentTypesAceitos: ['text/plain'] },
  xlsx: {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensoes: ['xlsx'],
    contentTypesAceitos: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  docx: {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensoes: ['docx'],
    contentTypesAceitos: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
  zip: {
    contentType: 'application/zip',
    extensoes: ['zip'],
    contentTypesAceitos: ['application/zip', 'application/x-zip-compressed'],
  },
  ttf: { contentType: 'font/ttf', extensoes: ['ttf'], contentTypesAceitos: ['font/ttf', 'application/x-font-ttf', 'font/sfnt'] },
  otf: { contentType: 'font/otf', extensoes: ['otf'], contentTypesAceitos: ['font/otf', 'application/x-font-opentype', 'font/sfnt'] },
  woff2: { contentType: 'font/woff2', extensoes: ['woff2'], contentTypesAceitos: ['font/woff2', 'application/font-woff2'] },
};

export type MotivoDeRecusa =
  | 'arquivo_vazio'
  | 'arquivo_grande_demais'
  | 'cota_excedida'
  | 'tipo_nao_permitido'
  | 'tipo_divergente'
  | 'extensao_divergente'
  | 'conteudo_suspeito';

export type AvaliacaoDeArquivo =
  | { ok: true; tipo: TipoPermitido; contentType: string; nomeSeguro: string }
  | { ok: false; motivo: MotivoDeRecusa; mensagem: string };

export type EntradaDeAvaliacao = {
  nome: string;
  contentTypeDeclarado?: string | undefined;
  tamanhoBytes: number;
  amostra: Uint8Array;
  usoAtualDoClienteBytes: number;
};

const MENSAGENS: Record<MotivoDeRecusa, string> = {
  arquivo_vazio: 'O arquivo está vazio.',
  arquivo_grande_demais: 'O arquivo passa do tamanho máximo de 25 MB.',
  cota_excedida: 'O cliente atingiu o limite de 500 MB de arquivos.',
  tipo_nao_permitido: 'Esse tipo de arquivo não é aceito.',
  tipo_divergente: 'O tipo informado não bate com o conteúdo do arquivo.',
  extensao_divergente: 'A extensão do nome não bate com o conteúdo do arquivo.',
  conteudo_suspeito: 'O conteúdo do arquivo parece conter código ativo e foi recusado.',
};

function recusar(motivo: MotivoDeRecusa): AvaliacaoDeArquivo {
  return { ok: false, motivo, mensagem: MENSAGENS[motivo] };
}

function comecaCom(amostra: Uint8Array, assinatura: number[], deslocamento = 0): boolean {
  if (amostra.length < deslocamento + assinatura.length) return false;
  return assinatura.every((byte, indice) => amostra[deslocamento + indice] === byte);
}

function ascii(texto: string): number[] {
  return Array.from(texto, (caractere) => caractere.charCodeAt(0));
}

function contemTexto(amostra: Uint8Array, texto: string): boolean {
  return Buffer.from(amostra).includes(Buffer.from(texto, 'latin1'));
}

const ASSINATURAS_EXECUTAVEIS: number[][] = [
  [0x4d, 0x5a],
  [0x7f, 0x45, 0x4c, 0x46],
  [0xca, 0xfe, 0xba, 0xbe],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xce, 0xfa, 0xed, 0xfe],
  [0x23, 0x21],
];

export function pareceExecutavel(amostra: Uint8Array): boolean {
  return ASSINATURAS_EXECUTAVEIS.some((assinatura) => comecaCom(amostra, assinatura));
}

const MARCADORES_ATIVOS = ['<script', '<html', '<!doctype', '<svg', '<iframe', '<?php', 'javascript:'];

function textoEhSeguro(amostra: Uint8Array): boolean {
  if (amostra.includes(0)) return false;
  try {
    const texto = new TextDecoder('utf-8', { fatal: true }).decode(amostra).toLowerCase();
    return !MARCADORES_ATIVOS.some((marcador) => texto.includes(marcador));
  } catch {
    return false;
  }
}

function amostraTextualDecodificavel(amostra: Uint8Array): Uint8Array {
  if (amostra.length < BYTES_NECESSARIOS_PARA_IDENTIFICAR) return amostra;
  let fim = amostra.length;
  while (fim > 0 && ((amostra[fim - 1] ?? 0) & 0b1100_0000) === 0b1000_0000) fim -= 1;
  return amostra.subarray(0, Math.max(fim - 1, 0));
}

export function identificarPorConteudo(amostra: Uint8Array, extensao: string): TipoPermitido | null {
  if (comecaCom(amostra, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (comecaCom(amostra, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (comecaCom(amostra, ascii('GIF87a')) || comecaCom(amostra, ascii('GIF89a'))) return 'gif';
  if (comecaCom(amostra, ascii('RIFF')) && comecaCom(amostra, ascii('WEBP'), 8)) return 'webp';
  if (comecaCom(amostra, ascii('%PDF-'))) return 'pdf';
  if (comecaCom(amostra, ascii('wOF2'))) return 'woff2';
  if (comecaCom(amostra, ascii('OTTO'))) return 'otf';
  if (comecaCom(amostra, [0x00, 0x01, 0x00, 0x00]) || comecaCom(amostra, ascii('true'))) return 'ttf';
  if (comecaCom(amostra, [0x50, 0x4b, 0x03, 0x04])) {
    const janela = amostra.subarray(0, BYTES_NECESSARIOS_PARA_IDENTIFICAR);
    if (extensao === 'docx' && contemTexto(janela, 'word/')) return 'docx';
    if (extensao === 'xlsx' && contemTexto(janela, 'xl/')) return 'xlsx';
    return 'zip';
  }
  if (extensao === 'csv' || extensao === 'txt') {
    if (!textoEhSeguro(amostraTextualDecodificavel(amostra))) return null;
    return extensao === 'csv' ? 'csv' : 'txt';
  }
  return null;
}

function extensaoDe(nome: string): string {
  const seguro = nomeSeguro(nome);
  const ponto = seguro.lastIndexOf('.');
  return ponto > 0 ? seguro.slice(ponto + 1) : '';
}

function normalizarContentType(valor: string | undefined): string {
  return (valor ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

export function avaliarArquivo(entrada: EntradaDeAvaliacao): AvaliacaoDeArquivo {
  if (entrada.tamanhoBytes <= 0) return recusar('arquivo_vazio');
  if (entrada.tamanhoBytes > TAMANHO_MAXIMO_DO_ARQUIVO_BYTES) return recusar('arquivo_grande_demais');
  if (!cabeNaCota(entrada.usoAtualDoClienteBytes, entrada.tamanhoBytes)) return recusar('cota_excedida');
  if (pareceExecutavel(entrada.amostra)) return recusar('conteudo_suspeito');

  const extensao = extensaoDe(entrada.nome);
  const tipo = identificarPorConteudo(entrada.amostra, extensao);
  if (tipo === null) return recusar('tipo_nao_permitido');

  const definicao = TIPOS_PERMITIDOS[tipo];
  if (!definicao.extensoes.includes(extensao)) return recusar('extensao_divergente');

  const declarado = normalizarContentType(entrada.contentTypeDeclarado);
  const indeterminado = declarado === '' || declarado === 'application/octet-stream';
  if (!indeterminado && !definicao.contentTypesAceitos.includes(declarado)) return recusar('tipo_divergente');

  return { ok: true, tipo, contentType: definicao.contentType, nomeSeguro: nomeSeguro(entrada.nome) };
}

export function cabeNaCota(usoAtualBytes: number, novoArquivoBytes: number): boolean {
  return usoAtualBytes + novoArquivoBytes <= COTA_POR_CLIENTE_BYTES;
}

export type CabecalhosDeDownload = Record<string, string>;

export function cabecalhosDeDownload(nome: string, contentTypeArmazenado: string): CabecalhosDeDownload {
  const conhecido = Object.values(TIPOS_PERMITIDOS).some((definicao) => definicao.contentType === contentTypeArmazenado);
  const seguro = nomeSeguro(nome);
  return {
    'Content-Type': conhecido ? contentTypeArmazenado : 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${seguro}"; filename*=UTF-8''${encodeURIComponent(seguro)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    'Cache-Control': 'private, no-store',
  };
}
