import { type NextRequest, NextResponse } from 'next/server';
import { createHandoffRepository } from '@/modules/identity/infrastructure/handoffRepository';
import { abrirSessaoNaAutomacao } from '@/modules/identity/infrastructure/n8nSession';
import { isSafeReturnPath } from '@/modules/connections/domain/oauth';
import { HANDOFF_COOKIE, readHandoff } from '@/modules/identity/domain/handoff';
import { SESSION_MAX_AGE_SECONDS, issueSession } from '@/modules/identity/domain/session';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const configuration = env();
  const automacao = configuration.N8N_PUBLIC_URL;

  if (!automacao) {
    return NextResponse.redirect(new URL('/automacoes?erro=n8n_sem_endereco', configuration.TRIA_APP_BASE_URL));
  }

  const token = request.nextUrl.searchParams.get('t') ?? '';
  const passagem = readHandoff(token, configuration.TRIA_SESSION_SECRET, Date.now());

  if (!passagem) {
    logger.warn('portaria.recusada', { motivo: 'assinatura' });
    return NextResponse.redirect(new URL('/entrar?erro=estado', configuration.TRIA_APP_BASE_URL));
  }

  if (!(await createHandoffRepository().consume(passagem.jti, passagem.expiresAt))) {
    logger.warn('portaria.recusada', { motivo: 'reuso', userId: passagem.userId });
    return NextResponse.redirect(new URL('/entrar?erro=estado', configuration.TRIA_APP_BASE_URL));
  }

  const pedido = request.nextUrl.searchParams.get('de') ?? '/';
  const destino = new URL(isSafeReturnPath(pedido) ? pedido : '/', automacao);

  const response = NextResponse.redirect(destino);
  response.cookies.set(
    HANDOFF_COOKIE,
    issueSession(passagem.userId, configuration.TRIA_SESSION_SECRET, Date.now()),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: configuration.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  );

  const automacaoAberta = await abrirSessaoNaAutomacao();
  if (automacaoAberta.tipo === 'aberta') {
    for (const cookie of automacaoAberta.cookies) response.headers.append('set-cookie', cookie);
  }

  logger.info('portaria.aceita', { userId: passagem.userId, automacao: automacaoAberta.tipo });
  return response;
}
