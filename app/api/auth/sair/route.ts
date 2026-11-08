import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/modules/identity/domain/session';
import { env } from '@/shared/config/env';

export const dynamic = 'force-dynamic';

export function POST(): NextResponse {
  const response = NextResponse.redirect(new URL('/entrar', env().TRIA_APP_BASE_URL), { status: 303 });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
