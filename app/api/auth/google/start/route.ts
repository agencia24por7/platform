import { createHash, randomBytes } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { buildSigninUrl } from '@/modules/identity/domain/googleIdentity';
import { isSafeReturnPath } from '@/modules/connections/domain/oauth';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'tria_login_state';
const VERIFIER_COOKIE = 'tria_login_verifier';
const NONCE_COOKIE = 'tria_login_nonce';
const COOKIE_MAX_AGE = 600;

export function GET(request: NextRequest): NextResponse {
  const configuration = env();

  if (!configuration.GOOGLE_OAUTH_CLIENT_ID) {
    logger.warn('auth.start.not_configured', {});
    return NextResponse.redirect(new URL('/entrar?erro=indisponivel', configuration.TRIA_APP_BASE_URL));
  }

  const requested = request.nextUrl.searchParams.get('returnTo') ?? '/';
  const returnTo = isSafeReturnPath(requested) ? requested : '/';

  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const destination = buildSigninUrl({
    clientId: configuration.GOOGLE_OAUTH_CLIENT_ID,
    redirectUri: new URL('/api/auth/google/callback', configuration.TRIA_APP_BASE_URL).toString(),
    state,
    nonce,
    challenge,
  });

  const response = NextResponse.redirect(destination);
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: configuration.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };

  response.cookies.set(STATE_COOKIE, `${state}|${returnTo}`, options);
  response.cookies.set(VERIFIER_COOKIE, verifier, options);
  response.cookies.set(NONCE_COOKIE, nonce, options);

  return response;
}
