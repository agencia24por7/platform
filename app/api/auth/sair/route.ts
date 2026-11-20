import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { modules } from '@/composition';
import { SESSION_COOKIE, readSession } from '@/modules/identity/domain/session';
import { env } from '@/shared/config/env';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const configuracao = env();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const sessao = token ? readSession(token, configuracao.TRIA_SESSION_SECRET, Date.now()) : null;
  if (sessao) await modules().identity.encerrarSessoes(sessao.userId);

  const response = NextResponse.redirect(new URL('/entrar', configuracao.TRIA_APP_BASE_URL), { status: 303 });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: configuracao.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
