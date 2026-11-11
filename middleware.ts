import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/modules/identity/domain/sessionCookie';

function enderecoPublico(): string {
  const configurado = process.env['TRIA_APP_BASE_URL'];
  if (!configurado) throw new Error('TRIA_APP_BASE_URL ausente: o app não sabe o próprio endereço.');

  return configurado;
}

const ROTAS_ABERTAS = [
  '/entrar',
  '/api/auth',
  '/api/health',
  '/api/v0',
  '/api/portaria',
  '/api/erros',
  '/api/webhooks',
];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (ROTAS_ABERTAS.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const destino = new URL('/api/auth/google/start', enderecoPublico());
  if (pathname !== '/') destino.searchParams.set('returnTo', pathname);

  return NextResponse.redirect(destino);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|marcas/|orla/|icon.png|apple-icon.png|opengraph-image).*)',
  ],
};
