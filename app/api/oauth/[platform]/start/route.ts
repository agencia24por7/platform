import { randomBytes, createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/shared/config/env';
import { currentOrganization } from '@/shared/http/currentOrganization';
import { encodeStateCookie } from '@/modules/connections/domain/tenantBinding';
import { logger } from '@/shared/logging/logger';
import {
  PROVIDERS,
  authorizeUrlFor,
  falaOauth,
  isConfigured,
  isSafeReturnPath,
  type PlataformaOauth,
  type ProviderCredentials,
} from '@/modules/connections/domain/oauth';
import type { Platform } from '@/modules/connections/domain/connection';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'tria_oauth_state';
const VERIFIER_COOKIE = 'tria_oauth_verifier';
const COOKIE_MAX_AGE = 600;

function credentialsFor(platform: PlataformaOauth): ProviderCredentials {
  const config = env();

  const porPlataforma: Record<PlataformaOauth, ProviderCredentials> = {
    google: {
      clientId: config.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
    },
    ga4: {
      clientId: config.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
    },
    meta: {
      clientId: config.META_APP_ID,
      clientSecret: config.META_APP_SECRET,
      configId: config.META_LOGIN_CONFIG_ID,
    },
    rdstation: {
      clientId: config.RDSTATION_CLIENT_ID,
      clientSecret: config.RDSTATION_CLIENT_SECRET,
    },
  };

  return porPlataforma[platform];
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> },
): Promise<NextResponse> {
  const { platform } = await context.params;
  if (!falaOauth(platform as Platform)) {
    return NextResponse.redirect(new URL('/comecar?erro=plataforma_desconhecida', env().TRIA_APP_BASE_URL));
  }

  const credentials = credentialsFor(platform as PlataformaOauth);
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
  const organization = await currentOrganization();
  response.cookies.set(
    STATE_COOKIE,
    encodeStateCookie(
      { state, returnTo: safeReturn, organizationId: organization?.id ?? null },
      env().TRIA_SESSION_SECRET,
    ),
    options,
  );
  if (provider.usesPkce) response.cookies.set(VERIFIER_COOKIE, verifier, options);

  return response;
}
