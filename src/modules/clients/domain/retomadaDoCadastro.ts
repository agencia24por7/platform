import { createHmac, timingSafeEqual } from 'node:crypto';

export const VALIDADE_DA_RETOMADA_MS = 60 * 60 * 1000;
export const TAMANHO_MAXIMO_DA_RETOMADA = 512;

const FINALIDADE = 'orla.retomada-do-cadastro:v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type DonoDaRetomada = { readonly organizationId: string; readonly userId: string };

function assinar(corpo: string, segredo: string): string {
  const chave = createHmac('sha256', segredo).update(FINALIDADE).digest();
  return createHmac('sha256', chave).update(corpo).digest('base64url');
}

function confere(recebida: string, esperada: string): boolean {
  const a = Buffer.from(recebida);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function emitirRetomada(dono: DonoDaRetomada, clientId: string, segredo: string, agora: number): string {
  const corpo = JSON.stringify({ o: dono.organizationId, u: dono.userId, c: clientId, e: agora + VALIDADE_DA_RETOMADA_MS });
  return `${Buffer.from(corpo).toString('base64url')}.${assinar(corpo, segredo)}`;
}

export function clienteDaRetomada(bruto: unknown, dono: DonoDaRetomada, segredo: string, agora: number): string | null {
  if (typeof bruto !== 'string' || bruto.length === 0 || bruto.length > TAMANHO_MAXIMO_DA_RETOMADA) return null;
  const separador = bruto.lastIndexOf('.');
  if (separador < 1) return null;
  const corpo = Buffer.from(bruto.slice(0, separador), 'base64url').toString('utf8');
  if (!confere(bruto.slice(separador + 1), assinar(corpo, segredo))) return null;

  let lido: unknown;
  try {
    lido = JSON.parse(corpo);
  } catch {
    return null;
  }
  if (typeof lido !== 'object' || lido === null) return null;
  const { o, u, c, e } = lido as Record<string, unknown>;
  if (o !== dono.organizationId || u !== dono.userId) return null;
  if (typeof e !== 'number' || e <= agora) return null;
  return typeof c === 'string' && UUID.test(c) ? c : null;
}
