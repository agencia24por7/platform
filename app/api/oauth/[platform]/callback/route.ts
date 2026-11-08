import { NextResponse, type NextRequest } from 'next/server';
import { modules } from '@/composition';
import { currentUser } from '@/shared/http/currentUser';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { newRequestId, secureCompare } from '@/shared/security/tokens';
import { isSafeReturnPath, sameOrigin } from '@/modules/connections/domain/oauth';
import { decodeStateCookie } from '@/modules/connections/domain/tenantBinding';
import type { Platform } from '@/modules/connections/domain/connection';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'tria_oauth_state';
const VERIFIER_COOKIE = 'tria_oauth_verifier';

function clear(response: NextResponse): NextResponse {
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(VERIFIER_COOKIE);
  return response;
}

function backTo(request: NextRequest, reason: string): NextResponse {
  return clear(NextResponse.redirect(new URL(`/comecar?passo=conectar&erro=${reason}`, request.url)));
}

function credentialsFor(platform: Platform) {
  const config = env();
  return platform === 'google'
    ? { clientId: config.GOOGLE_OAUTH_CLIENT_ID, clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET }
    : { clientId: config.META_APP_ID, clientSecret: config.META_APP_SECRET };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> },
): Promise<NextResponse> {
  const { platform } = await context.params;
  if (platform !== 'google' && platform !== 'meta') return backTo(request, 'plataforma_desconhecida');

  const query = request.nextUrl.searchParams;
  const binding = decodeStateCookie(request.cookies.get(STATE_COOKIE)?.value ?? '', env().TRIA_SESSION_SECRET);
  const expectedState = binding?.state ?? '';
  const returnTo = binding?.returnTo ?? '/comecar?passo=contas';

  if (!expectedState || !secureCompare(query.get('state') ?? '', expectedState)) {
    logger.warn('oauth.callback.state_mismatch', { platform });
    return backTo(request, 'estado_invalido');
  }

  if (query.get('error')) {
    logger.info('oauth.callback.denied', { platform, reason: query.get('error') });
    return backTo(request, 'autorizacao_negada');
  }

  const code = query.get('code');
  if (!code) return backTo(request, 'sem_codigo');

  const credentials = credentialsFor(platform);
  if (!credentials.clientId || !credentials.clientSecret) return backTo(request, 'app_indisponivel');

  const sessao = await currentUser();
  if (!sessao) return backTo(request, 'sessao_expirada');

  const requestId = request.headers.get('x-request-id') ?? newRequestId();

  const outcome = await modules().authorization.complete({
    organizationId: binding?.organizationId ?? null,
    actorId: sessao.user.id,
    platform,
    code,
    codeVerifier: request.cookies.get(VERIFIER_COOKIE)?.value ?? null,
    redirectUri: new URL(`/api/oauth/${platform}/callback`, env().TRIA_APP_BASE_URL).toString(),
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    requestId,
    sourceIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  if (!outcome.ok) {
    logger.warn('oauth.callback.authorization_failed', { platform, code: outcome.error.code });
    return backTo(
      request,
      outcome.error.code === 'forbidden' ? 'autorizacao_recusada' : 'falha_autorizacao',
    );
  }

  if (outcome.value.organizationCreated) {
    const posse = await modules().identity.joinAsOwner(outcome.value.organizationId, {
      userId: sessao.user.id,
      requestId,
      sourceIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    });
    if (!posse.ok) {
      logger.warn('oauth.callback.ownership_failed', { platform, code: posse.error.code });
    }
  }

  const base = env().TRIA_APP_BASE_URL;
  const destination = isSafeReturnPath(returnTo) ? returnTo : '/comecar?passo=contas';
  const url = new URL(destination, base);

  if (!sameOrigin(url, base)) {
    logger.warn('oauth.callback.redirect_blocked', { platform });
    return clear(NextResponse.redirect(new URL('/comecar?passo=conectar', base)));
  }

  url.searchParams.set('autorizado', platform);
  url.searchParams.set('descobertas', String(outcome.value.discovered));

  return clear(NextResponse.redirect(url));
}
