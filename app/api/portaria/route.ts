import { type NextRequest, NextResponse } from 'next/server';
import { HANDOFF_COOKIE, SEM_AUTOMACAO_COOKIE } from '@/modules/identity/domain/handoff';
import { modules } from '@/composition';
import { readSession } from '@/modules/identity/domain/session';
import { env } from '@/shared/config/env';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const configuration = env();
  const token = request.cookies.get(HANDOFF_COOKIE)?.value ?? '';

  const sessao = readSession(token, configuration.TRIA_SESSION_SECRET, Date.now());
  const temSessaoDaTria = Boolean(sessao && (await modules().identity.sessaoValida(sessao.userId, sessao.issuedAt)));
  const temSessaoDaAutomacao = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith('n8n-auth') && cookie.value.length > 0);
  const pontePausada = Boolean(request.cookies.get(SEM_AUTOMACAO_COOKIE)?.value);

  if (temSessaoDaTria && (temSessaoDaAutomacao || pontePausada)) {
    return new NextResponse(null, { status: 204 });
  }

  const destino = new URL('/api/portaria/emitir', configuration.TRIA_APP_BASE_URL);
  const pedido = request.headers.get('x-original-uri');
  if (pedido && pedido.startsWith('/') && !pedido.startsWith('//')) {
    destino.searchParams.set('de', pedido);
  }

  return NextResponse.redirect(destino, { status: 302 });
}
