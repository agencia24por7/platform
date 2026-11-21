import type { CampoSimples, CategoriaDeArquivo } from '@/modules/clients/domain/contexto/catalogo';
import { formatarNumero, numeroDeTexto } from '@/modules/clients/domain/painel/formato';

export type ValorDaUi = string | number | boolean | readonly string[] | null;

export function valorParaUi(campo: CampoSimples, valor: unknown): ValorDaUi {
  if (valor === null || valor === undefined) {
    if (campo.tipo === 'multipla') return [];
    if (campo.tipo === 'dinheiro' || campo.tipo === 'escala' || campo.tipo === 'booleano') return null;
    return '';
  }
  switch (campo.tipo) {
    case 'multipla':
      return Array.isArray(valor) ? valor.map(String) : [String(valor)];
    case 'numero':
      return typeof valor === 'number' ? formatarNumero(valor) : String(valor);
    case 'dinheiro':
    case 'escala':
      return typeof valor === 'number' ? valor : null;
    case 'booleano':
      return typeof valor === 'boolean' ? valor : null;
    default:
      return typeof valor === 'string' ? valor : String(valor);
  }
}

export function valorParaServidor(campo: CampoSimples, ui: ValorDaUi): unknown {
  switch (campo.tipo) {
    case 'multipla':
      return Array.isArray(ui) && ui.length > 0 ? ui : null;
    case 'numero': {
      if (typeof ui !== 'string' || ui.trim() === '') return null;
      return numeroDeTexto(ui) ?? ui;
    }
    case 'dinheiro':
    case 'escala':
      return typeof ui === 'number' ? ui : null;
    case 'booleano':
      return typeof ui === 'boolean' ? ui : null;
    default:
      return typeof ui === 'string' && ui.trim() !== '' ? ui : null;
  }
}

export function preenchidoNaUi(ui: ValorDaUi): boolean {
  if (ui === null) return false;
  if (typeof ui === 'string') return ui.trim().length > 0;
  if (Array.isArray(ui)) return ui.length > 0;
  return true;
}

const ACEITE: Record<CategoriaDeArquivo, string> = {
  imagem: 'image/png,image/jpeg,image/webp,image/gif',
  documento: '.pdf,.docx,.txt,application/pdf',
  planilha: '.csv,.xlsx,text/csv',
  video: '.mp4,.mov,video/mp4,video/quicktime',
  fonte: '.ttf,.otf,.woff2',
};

export function aceiteDasCategorias(categorias: readonly CategoriaDeArquivo[]): string {
  return categorias.map((c) => ACEITE[c]).join(',');
}

export const ROTULO_DA_CATEGORIA: Record<CategoriaDeArquivo, string> = {
  imagem: 'imagens (PNG, JPG, WebP, GIF)',
  documento: 'documentos (PDF, DOCX, TXT)',
  planilha: 'planilhas (CSV, XLSX)',
  video: 'vídeos (MP4, MOV)',
  fonte: 'fontes (TTF, OTF, WOFF2)',
};
