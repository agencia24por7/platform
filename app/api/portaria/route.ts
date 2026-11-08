import { type NextRequest, NextResponse } from 'next/server';
import { HANDOFF_COOKIE } from '@/modules/identity/domain/handoff';
import { readSession } from '@/modules/identity/domain/session';
import { env } from '@/shared/config/env';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest): NextResponse {
  const configuration = env();
  const token = request.cookies.get(HANDOFF_COOKIE)?.value ?? '';

  const temSessaoDaTria = Boolean(readSession(token, configuration.TRIA_SESSION_SECRET, Date.now()));
  const temSessaoDaAutomacao = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith('n8n-auth') && cookie.value.length > 0);

  if (temSessaoDaTria && temSessaoDaAutomacao) {
    return new NextResponse(null, { status: 204 });
  }

  const destino = new URL('/api/portaria/emitir', configuration.TRIA_APP_BASE_URL);
  const pedido = request.headers.get('x-original-uri');
  if (pedido && pedido.startsWith('/') && !pedido.startsWith('//')) {
    destino.searchParams.set('de', pedido);
  }

  return NextResponse.redirect(destino, { status: 302 });
}
