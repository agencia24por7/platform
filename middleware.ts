import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/modules/identity/domain/sessionCookie';

const ROTAS_ABERTAS = ['/entrar', '/api/auth', '/api/health', '/api/v0'];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (ROTAS_ABERTAS.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const destino = request.nextUrl.clone();
  destino.pathname = '/entrar';
  destino.search = pathname === '/' ? '' : `?returnTo=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(destino);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|marcas/).*)'],
};
