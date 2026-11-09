import { NextResponse } from 'next/server';
import { currentUser } from '@/shared/http/currentUser';
import { logger } from '@/shared/logging/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as { message?: string; digest?: string; stack?: string } | null;
  const session = await currentUser();

  logger.error('client.erro', {
    message: body?.message ?? 'desconhecido',
    digest: body?.digest ?? null,
    stack: body?.stack ?? null,
    userId: session?.user.id ?? null,
    path: request.headers.get('referer'),
  });

  return new NextResponse(null, { status: 204 });
}
