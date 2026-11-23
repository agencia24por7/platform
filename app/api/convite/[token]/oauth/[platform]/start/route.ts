import { randomBytes, createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { consume } from '@/shared/security/rateLimit';
import { enderecoConfiavel } from '@/modules/audit/domain/actor';
import { encodeStateCookie } from '@/modules/connections/domain/tenantBinding';
import { convidavelPorLink } from '@/modules/connections/domain/integrationInvite';
import {
  PROVIDERS,
  isSafeReturnPath,
  authorizeUrlFor,
  falaOauth,
  isConfigured,
  type PlataformaOauth,
} from '@/modules/connections/domain/oauth';
import { credenciaisDaPlataforma } from '@/modules/connections/application/credenciaisOauth';
import { modules } from '@/composition';
import type { Platform } from '@/modules/connections/domain/connection';
import { entradaPublica } from '@/shared/http/entradaPublica';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'tria_oauth_state';
const VERIFIER_COOKIE = 'tria_oauth_verifier';
const COOKIE_MAX_AGE = 600;
const LIMITE_POR_JANELA = 20;
const JANELA_MS = 10 * 60 * 1000;

function sourceIp(request: NextRequest): string {
  return enderecoConfiavel(request.headers.get('x-forwarded-for')) ?? 'desconhecido';
}

async function tratarGet(
  request: NextRequest,
  context: { params: Promise<{ token: string; platform: string }> },
): Promise<NextResponse> {
  const { token, platform } = await context.params;
  const falha = (erro: string): NextResponse =>
    NextResponse.redirect(new URL(`/convite/${token}?erro=${erro}`, env().TRIA_APP_BASE_URL));

  const verdict = consume(`convite:oauth:start:${sourceIp(request)}`, LIMITE_POR_JANELA, JANELA_MS);
  if (!verdict.allowed) return falha('muitas_tentativas');

  if (!falaOauth(platform as Platform) || !convidavelPorLink(platform as Platform)) {
    return falha('plataforma_desconhecida');
  }
  const plataforma = platform as PlataformaOauth;

  const resolvido = await modules().connectionInvites.resolveByToken(token, plataforma);
  if (!resolvido) {
    logger.warn('convite.oauth.start.token_invalido', { platform: plataforma });
    return falha('convite_invalido');
  }

  const credentials = credenciaisDaPlataforma(plataforma);
  if (!isConfigured(credentials, plataforma)) {
    logger.info('convite.oauth.start.not_configured', { platform: plataforma });
    return falha('indisponivel');
  }

  const provider = PROVIDERS[plataforma];
  const state = `${plataforma}.${randomBytes(24).toString('base64url')}`;
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = new URL(`/api/oauth/${plataforma}/callback`, env().TRIA_APP_BASE_URL).toString();

  const destination = authorizeUrlFor(provider, {
    clientId: credentials.clientId!,
    redirectUri,
    state,
    codeChallenge: provider.usesPkce ? challenge : undefined,
    configId: credentials.configId,
  });

  const nao = request.nextUrl.searchParams.get('nao') ?? '';
  const retorno = /^[a-z0-9_,]{1,120}$/.test(nao) ? `/convite/${token}?nao=${nao}` : `/convite/${token}`;
  const response = NextResponse.redirect(destination);
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env().NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
  response.cookies.set(
    STATE_COOKIE,
    encodeStateCookie(
      {
        state,
        returnTo: isSafeReturnPath(retorno) ? retorno : `/convite/${token}`,
        organizationId: resolvido.organizationId,
        userId: null,
        inviteItemId: resolvido.itemId,
      },
      env().TRIA_SESSION_SECRET,
    ),
    options,
  );
  if (provider.usesPkce) response.cookies.set(VERIFIER_COOKIE, verifier, options);

  return response;
}

export const GET = entradaPublica(tratarGet);
