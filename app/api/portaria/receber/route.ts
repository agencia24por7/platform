import { type NextRequest, NextResponse } from 'next/server';
import { isSafeReturnPath } from '@/modules/connections/domain/oauth';
import { HANDOFF_COOKIE, readHandoff } from '@/modules/identity/domain/handoff';
import { SESSION_MAX_AGE_SECONDS, issueSession } from '@/modules/identity/domain/session';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest): NextResponse {
  const configuration = env();
  const automacao = configuration.N8N_PUBLIC_URL;

  if (!automacao) {
    return NextResponse.redirect(new URL('/automacoes?erro=n8n_sem_endereco', configuration.TRIA_APP_BASE_URL));
  }

  const token = request.nextUrl.searchParams.get('t') ?? '';
  const userId = readHandoff(token, configuration.TRIA_SESSION_SECRET, Date.now());

  if (!userId) {
    logger.warn('portaria.recusada', {});
    return NextResponse.redirect(new URL('/entrar?erro=estado', configuration.TRIA_APP_BASE_URL));
  }

  const pedido = request.nextUrl.searchParams.get('de') ?? '/';
  const destino = new URL(isSafeReturnPath(pedido) ? pedido : '/', automacao);

  const response = NextResponse.redirect(destino);
  response.cookies.set(
    HANDOFF_COOKIE,
    issueSession(userId, configuration.TRIA_SESSION_SECRET, Date.now()),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: configuration.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  );

  logger.info('portaria.aceita', { userId });
  return response;
}
