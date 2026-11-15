import { type NextRequest, NextResponse } from 'next/server';
import { modules } from '@/composition';
import { isSafeReturnPath, requestCameFromBase } from '@/modules/connections/domain/oauth';
import {
  GOOGLE_TOKEN_URL,
  decodeIdTokenClaims,
  identityFromClaims,
} from '@/modules/identity/domain/googleIdentity';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, issueSession } from '@/modules/identity/domain/session';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { enderecoConfiavel } from '@/modules/audit/domain/actor';
import { newRequestId, secureCompare } from '@/shared/security/tokens';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'tria_login_state';
const VERIFIER_COOKIE = 'tria_login_verifier';
const NONCE_COOKIE = 'tria_login_nonce';

function clearTransientCookies(response: NextResponse): NextResponse {
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(VERIFIER_COOKIE);
  response.cookies.delete(NONCE_COOKIE);
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const configuration = env();
  const base = configuration.TRIA_APP_BASE_URL;
  const requestId = newRequestId();

  const deny = (reason: string): NextResponse => {
    logger.warn('auth.callback.denied', { requestId, reason });
    return clearTransientCookies(NextResponse.redirect(new URL(`/entrar?erro=${reason}`, base)));
  };

  const origem = {
    host: request.headers.get('host'),
    forwardedHost: request.headers.get('x-forwarded-host'),
    forwardedProtocol: request.headers.get('x-forwarded-proto'),
  };
  if (!requestCameFromBase(origem, base)) {
    logger.warn('auth.callback.origem', { requestId, ...origem });
    return deny('origem');
  }
  if (!configuration.GOOGLE_OAUTH_CLIENT_ID || !configuration.GOOGLE_OAUTH_CLIENT_SECRET) {
    return deny('indisponivel');
  }

  const query = request.nextUrl.searchParams;
  if (query.get('error')) return deny('recusado');

  const cookie = request.cookies.get(STATE_COOKIE)?.value ?? '';
  const separator = cookie.indexOf('|');
  const expectedState = separator > 0 ? cookie.slice(0, separator) : '';
  const requestedReturn = separator > 0 ? cookie.slice(separator + 1) : '/';
  const returnTo = isSafeReturnPath(requestedReturn) ? requestedReturn : '/';

  if (!expectedState || !secureCompare(query.get('state') ?? '', expectedState)) {
    return deny('estado');
  }

  const code = query.get('code');
  const verifier = request.cookies.get(VERIFIER_COOKIE)?.value;
  if (!code || !verifier) return deny('codigo');

  const exchange = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: configuration.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: configuration.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: new URL('/api/auth/google/callback', base).toString(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });

  if (!exchange.ok) return deny('troca');

  const payload = (await exchange.json()) as { id_token?: unknown };
  if (typeof payload.id_token !== 'string') return deny('sem_identidade');

  const claims = decodeIdTokenClaims(payload.id_token);
  if (!claims) return deny('identidade_ilegivel');

  const expectedNonce = request.cookies.get(NONCE_COOKIE)?.value ?? '';
  if (!expectedNonce || !claims.nonce || !secureCompare(claims.nonce, expectedNonce)) {
    return deny('nonce');
  }

  const identity = identityFromClaims(claims, configuration.GOOGLE_OAUTH_CLIENT_ID, Date.now());
  if (!identity) return deny('identidade_invalida');

  const ator = {
    userId: null,
    requestId,
    sourceIp: enderecoConfiavel(request.headers.get('x-forwarded-for')),
  };

  const signedIn = await modules().identity.signIn(identity, ator);
  if (!signedIn.ok) return deny('sem_acesso');

  const user = signedIn.value.user;
  const aceitos = await modules().team.aceitarPendentes(user.id, user.email, {
    ...ator,
    userId: user.id,
  });

  const vinculos =
    aceitos.length > 0 ? await modules().identity.membershipsOf(user.id) : signedIn.value.memberships;

  const destination = vinculos.length > 0 ? returnTo : '/organizacoes/nova';
  const response = clearTransientCookies(NextResponse.redirect(new URL(destination, base)));

  response.cookies.set(SESSION_COOKIE, issueSession(user.id, configuration.TRIA_SESSION_SECRET, Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: configuration.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  logger.info('auth.callback.signed_in', { requestId, userId: user.id, convitesAceitos: aceitos.length });
  return response;
}
