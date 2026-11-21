import { createHash, randomBytes } from 'node:crypto';
import { ehSecao, SECOES, type SecaoKey } from './catalogo.ts';

export const BYTES_DO_TOKEN = 32;
export const EXPIRACAO_PADRAO_EM_DIAS = 30;
export const EXPIRACAO_MAXIMA_EM_DIAS = 90;
export const MAX_NOTA = 500;
const MS_POR_DIA = 24 * 60 * 60 * 1000;
const FORMATO_DO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function gerarTokenDeContexto(): string {
  return randomBytes(BYTES_DO_TOKEN).toString('base64url');
}

export function tokenBemFormado(token: string): boolean {
  return FORMATO_DO_TOKEN.test(token);
}

export function hashDoToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export type EstadoDoLink = 'ativo' | 'expirado' | 'revogado';

export type LinkParaEstado = { readonly expiraEm: Date; readonly revogadoEm: Date | null };

export function estadoDoLink(link: LinkParaEstado, agora: Date): EstadoDoLink {
  if (link.revogadoEm) return 'revogado';
  return link.expiraEm.getTime() <= agora.getTime() ? 'expirado' : 'ativo';
}

export type MotivoDoLink = 'sem_secoes' | 'secao_invalida' | 'secao_duplicada' | 'prazo_invalido' | 'nota_longa';

export const MOTIVO_DO_LINK: Record<MotivoDoLink, string> = {
  sem_secoes: 'Escolha ao menos uma seção para o cliente preencher.',
  secao_invalida: 'Há uma seção que não existe no mapa de contexto.',
  secao_duplicada: 'Cada seção só entra uma vez no link.',
  prazo_invalido: `O link vale de 1 a ${EXPIRACAO_MAXIMA_EM_DIAS} dias.`,
  nota_longa: `A nota tem no máximo ${MAX_NOTA} caracteres.`,
};

export type PedidoDeLink = {
  readonly secoes: readonly string[];
  readonly expiraEmDias?: number | null;
  readonly nota?: string | null;
};

export type LinkValidado =
  | {
      readonly ok: true;
      readonly secoes: readonly SecaoKey[];
      readonly expiraEm: Date;
      readonly nota: string | null;
    }
  | { readonly ok: false; readonly motivo: MotivoDoLink };

export function validarPedidoDeLink(pedido: PedidoDeLink, agora: Date): LinkValidado {
  if (pedido.secoes.length === 0) return { ok: false, motivo: 'sem_secoes' };
  if (new Set(pedido.secoes).size !== pedido.secoes.length) return { ok: false, motivo: 'secao_duplicada' };
  if (!pedido.secoes.every(ehSecao)) return { ok: false, motivo: 'secao_invalida' };

  const dias = pedido.expiraEmDias ?? EXPIRACAO_PADRAO_EM_DIAS;
  if (!Number.isInteger(dias) || dias < 1 || dias > EXPIRACAO_MAXIMA_EM_DIAS) {
    return { ok: false, motivo: 'prazo_invalido' };
  }

  const nota = pedido.nota?.trim() ? pedido.nota.trim() : null;
  if (nota && nota.length > MAX_NOTA) return { ok: false, motivo: 'nota_longa' };

  const ordenadas = SECOES.filter((secao) => pedido.secoes.includes(secao));
  return { ok: true, secoes: ordenadas, expiraEm: new Date(agora.getTime() + dias * MS_POR_DIA), nota };
}
