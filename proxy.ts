import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/modules/identity/domain/sessionCookie';
import { CABECALHO_DO_NONCE, novoNonce, politicaDeSeguranca } from '@/shared/http/csp';

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
  '/convite',
  '/api/convite',
  '/api/oauth',
  '/sobre',
  '/privacidade',
  '/termos',
  '/exclusao-de-dados',
];

function seguirComNonce(request: NextRequest): NextResponse {
  const nonce = novoNonce();
  const politica = politicaDeSeguranca(nonce, process.env.NODE_ENV === 'development');

  const cabecalhos = new Headers(request.headers);
  cabecalhos.set(CABECALHO_DO_NONCE, nonce);
  cabecalhos.set('Content-Security-Policy', politica);

  const resposta = NextResponse.next({ request: { headers: cabecalhos } });
  resposta.headers.set('Content-Security-Policy', politica);
  return resposta;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (ROTAS_ABERTAS.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`))) {
    return seguirComNonce(request);
  }

  if (request.cookies.get(SESSION_COOKIE)?.value) return seguirComNonce(request);

  const destino = new URL('/api/auth/google/start', enderecoPublico());
  if (pathname !== '/') destino.searchParams.set('returnTo', pathname);

  return NextResponse.redirect(destino);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|marcas/|orla/|icon.png|apple-icon.png|opengraph-image).*)',
  ],
};
