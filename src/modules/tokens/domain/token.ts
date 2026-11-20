import type { Platform } from '@/modules/connections/domain/connection';

export const TIPOS_DE_SEGREDO = ['oauth_refresh', 'oauth_long_lived', 'api_key'] as const;
export type TipoDeSegredo = (typeof TIPOS_DE_SEGREDO)[number];

export type FormaDoAcesso = 'bearer' | 'query' | 'chave';

export type Acesso = {
  readonly token: string;
  readonly tipo: FormaDoAcesso;
  readonly expiraEm: Date | null;
  readonly cabecalhosExtras?: Readonly<Record<string, string>>;
};

export type Finalidade = 'segredo' | 'acesso';

export type ContextoDeCifra = {
  readonly connectionId: string;
  readonly platform: Platform;
  readonly finalidade: Finalidade;
};

export type Alvo = {
  readonly organizationId: string;
  readonly connectionId: string;
};

export const MARGEM_DE_EXPIRACAO_MS = 5 * 60_000;
export const MARGEM_DO_ACESSO_EMITIDO_MS = 30 * 60_000;
export const PRAZO_DA_RENOVACAO_MS = 15_000;
export const TETO_DO_CACHE_SEM_VALIDADE_MS = 15 * 60_000;
export const ANTECEDENCIA_DA_RENOVACAO_META_MS = 15 * 86_400_000;

export function aadDe(contexto: ContextoDeCifra): Buffer {
  return Buffer.from(`orla.tokens.v1|${contexto.connectionId}|${contexto.platform}|${contexto.finalidade}`, 'utf8');
}

export function aindaValido(expiraEm: Date | null, agora: Date, margemMs = MARGEM_DE_EXPIRACAO_MS): boolean {
  return expiraEm === null || expiraEm.getTime() - margemMs > agora.getTime();
}

export function validadeDoCache(expiraEm: Date | null, agora: Date, margemMs = MARGEM_DE_EXPIRACAO_MS): number {
  const teto = agora.getTime() + TETO_DO_CACHE_SEM_VALIDADE_MS;
  if (expiraEm === null) return teto;
  return Math.min(teto, expiraEm.getTime() - margemMs);
}

export function margemDoAcesso(tipo: TipoDeSegredo): number {
  return tipo === 'oauth_refresh' ? MARGEM_DO_ACESSO_EMITIDO_MS : MARGEM_DE_EXPIRACAO_MS;
}

export function precisaRenovarProativamente(segredoExpiraEm: Date | null, agora: Date): boolean {
  return segredoExpiraEm !== null && segredoExpiraEm.getTime() - ANTECEDENCIA_DA_RENOVACAO_META_MS <= agora.getTime();
}

const FORMA_DA_CHAVE: Partial<Record<Platform, FormaDoAcesso>> = {
  apify: 'bearer',
  rdstation: 'query',
  zapi: 'chave',
};

export function formaDoAcesso(tipo: TipoDeSegredo, platform: Platform): FormaDoAcesso {
  if (tipo !== 'api_key') return 'bearer';
  return FORMA_DA_CHAVE[platform] ?? 'chave';
}
