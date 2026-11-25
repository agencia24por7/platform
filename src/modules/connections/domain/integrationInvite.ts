import { randomBytes } from 'node:crypto';
import type { Platform } from './connection.ts';

export const PLATAFORMAS_CONVIDAVEIS = [
  'google',
  'meta',
  'ga4',
  'gtm',
  'pixel',
  'leadads',
  'searchconsole',
  'youtube',
  'gbp',
  'whatsapp',
] as const;
export type PlataformaConvidavel = (typeof PLATAFORMAS_CONVIDAVEIS)[number];

export function convidavelPorLink(platform: Platform): platform is PlataformaConvidavel {
  return (PLATAFORMAS_CONVIDAVEIS as readonly string[]).includes(platform);
}

const EXPIRACAO_EM_DIAS = 7;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

const FORMATO_DO_TOKEN_DE_CONVITE = /^[A-Za-z0-9_-]{16,64}$/;

export function tokenDeConviteBemFormado(token: string): boolean {
  return FORMATO_DO_TOKEN_DE_CONVITE.test(token);
}

export function gerarTokenDeConvite(): string {
  return randomBytes(24).toString('base64url');
}

export function expiracaoPadrao(agora: Date): Date {
  return new Date(agora.getTime() + EXPIRACAO_EM_DIAS * MS_POR_DIA);
}

export function conviteExpirado(expiresAt: Date, agora: Date): boolean {
  return expiresAt.getTime() <= agora.getTime();
}

export type MotivoDoConviteDeIntegracao = 'vazio' | 'duplicada' | 'plataforma_invalida';

export const MOTIVO_DO_CONVITE_DE_INTEGRACAO: Record<MotivoDoConviteDeIntegracao, string> = {
  vazio: 'Escolha ao menos uma plataforma para o convite.',
  duplicada: 'Cada plataforma só pode entrar uma vez no mesmo convite.',
  plataforma_invalida: 'Essa plataforma não entra no convite por link. Use a autorização direta.',
};

export type PlataformasEscolhidas =
  | { readonly ok: true; readonly platforms: readonly PlataformaConvidavel[] }
  | { readonly ok: false; readonly motivo: MotivoDoConviteDeIntegracao };

export function validarPlataformasEscolhidas(bruto: readonly string[]): PlataformasEscolhidas {
  if (bruto.length === 0) return { ok: false, motivo: 'vazio' };
  if (new Set(bruto).size !== bruto.length) return { ok: false, motivo: 'duplicada' };

  const invalida = bruto.find((platform) => !convidavelPorLink(platform as Platform));
  if (invalida) return { ok: false, motivo: 'plataforma_invalida' };

  return { ok: true, platforms: bruto as readonly PlataformaConvidavel[] };
}
