import { usaOauthDaMeta, usaOauthDoGoogle, type GrantedToken, type PlataformaOauth } from './oauth.ts';
import type { TipoDeSegredo } from '../../tokens/domain/token.ts';

export const VALIDADE_PADRAO_DO_TOKEN_DA_META_MS = 60 * 86_400_000;

export type SegredoDaAutorizacao = {
  readonly tipo: TipoDeSegredo;
  readonly segredo: string;
  readonly expiraEm: Date | null;
};

export type RecusaDoSegredo = 'sem_refresh_token' | 'plataforma_sem_cofre';

export function segredoDaAutorizacao(
  platform: PlataformaOauth,
  concedido: GrantedToken,
  agora: Date,
): { readonly ok: true; readonly value: SegredoDaAutorizacao } | { readonly ok: false; readonly error: RecusaDoSegredo } {
  if (usaOauthDoGoogle(platform)) {
    if (!concedido.refreshToken) return { ok: false, error: 'sem_refresh_token' };
    return { ok: true, value: { tipo: 'oauth_refresh', segredo: concedido.refreshToken, expiraEm: null } };
  }

  if (usaOauthDaMeta(platform)) {
    const validadeMs = concedido.expiresInSeconds && concedido.expiresInSeconds > 0
      ? concedido.expiresInSeconds * 1000
      : VALIDADE_PADRAO_DO_TOKEN_DA_META_MS;
    return {
      ok: true,
      value: { tipo: 'oauth_long_lived', segredo: concedido.accessToken, expiraEm: new Date(agora.getTime() + validadeMs) },
    };
  }

  return { ok: false, error: 'plataforma_sem_cofre' };
}

export const MENSAGEM_DA_RECUSA_DO_SEGREDO: Readonly<Record<RecusaDoSegredo, string>> = {
  sem_refresh_token:
    'O Google não devolveu acesso offline (refresh token). Revogue o acesso da Orla na sua Conta Google e autorize de novo.',
  plataforma_sem_cofre: 'Esta plataforma se conecta por chave de API, não por autorização. Use a opção de chave na tela do conector.',
};
