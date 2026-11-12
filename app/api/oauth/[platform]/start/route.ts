import { randomBytes, createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/shared/config/env';
import { activeContext } from '@/shared/http/currentOrganization';
import { currentUser } from '@/shared/http/currentUser';
import { canAdminister } from '@/modules/identity/domain/user';
import { encodeStateCookie } from '@/modules/connections/domain/tenantBinding';
import { logger } from '@/shared/logging/logger';
import {
  PROVIDERS,
  authorizeUrlFor,
  falaOauth,
  isConfigured,
  isSafeReturnPath,
  type PlataformaOauth,
} from '@/modules/connections/domain/oauth';
import { credenciaisDaPlataforma } from '@/modules/connections/application/credenciaisOauth';
import type { Platform } from '@/modules/connections/domain/connection';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'tria_oauth_state';
const VERIFIER_COOKIE = 'tria_oauth_verifier';
const COOKIE_MAX_AGE = 600;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> },
): Promise<NextResponse> {
  const { platform } = await context.params;
  if (!falaOauth(platform as Platform)) {
    return NextResponse.redirect(new URL('/comecar?erro=plataforma_desconhecida', env().TRIA_APP_BASE_URL));
  }

  const sessao = await currentUser();
  if (!sessao) {
    return NextResponse.redirect(new URL('/entrar', env().TRIA_APP_BASE_URL));
  }

  const contexto = await activeContext();
  if (contexto) {
    if (contexto.clientIds !== null) {
      logger.warn('oauth.start.recusado_recorte', { platform, userId: sessao.user.id });
      return NextResponse.redirect(new URL('/clientes', env().TRIA_APP_BASE_URL));
    }
    if (!canAdminister(contexto.role)) {
      logger.warn('oauth.start.recusado_papel', { platform, userId: sessao.user.id, role: contexto.role });
      return NextResponse.redirect(
        new URL('/integracoes?aviso=' + encodeURIComponent('Só quem administra a organização pode autorizar plataformas.'), env().TRIA_APP_BASE_URL),
      );
    }
  }


  const credentials = credenciaisDaPlataforma(platform as PlataformaOauth);
  if (!isConfigured(credentials, platform as Platform)) {
    logger.info('oauth.start.not_configured', { platform });
    return NextResponse.redirect(new URL(`/comecar?passo=conectar&indisponivel=${platform}`, env().TRIA_APP_BASE_URL));
  }

  const returnTo = request.nextUrl.searchParams.get('returnTo') ?? '/comecar?passo=contas';
  const safeReturn = isSafeReturnPath(returnTo) ? returnTo : '/comecar?passo=contas';

  const provider = PROVIDERS[platform as PlataformaOauth];
  const state = `${platform}.${randomBytes(24).toString('base64url')}`;
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = new URL(`/api/oauth/${platform}/callback`, env().TRIA_APP_BASE_URL).toString();

  const destination = authorizeUrlFor(provider, {
    clientId: credentials.clientId!,
    redirectUri,
    state,
    codeChallenge: provider.usesPkce ? challenge : undefined,
    configId: credentials.configId,
  });

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
        returnTo: safeReturn,
        organizationId: contexto?.organization.id ?? null,
        userId: sessao.user.id,
        inviteItemId: null,
      },
      env().TRIA_SESSION_SECRET,
    ),
    options,
  );
  if (provider.usesPkce) response.cookies.set(VERIFIER_COOKIE, verifier, options);

  return response;
}
