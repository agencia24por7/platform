import { NextResponse } from 'next/server';
import { currentUser } from '@/shared/http/currentUser';
import { logger } from '@/shared/logging/logger';

export const dynamic = 'force-dynamic';

const LIMITE_MENSAGEM = 2_000;
const LIMITE_PILHA = 8_000;
const LIMITE_DIGEST = 200;

function textoLimitado(valor: unknown, limite: number): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor.slice(0, limite) : null;
}

const LIMITE_CORPO_BYTES = 32_000;

export async function POST(request: Request): Promise<NextResponse> {
  const tamanho = Number(request.headers.get('content-length') ?? '0');
  if (tamanho > LIMITE_CORPO_BYTES) return new NextResponse(null, { status: 413 });

  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const session = await currentUser();

  logger.error('client.erro', {
    clientMessage: textoLimitado(corpo?.['message'], LIMITE_MENSAGEM),
    clientDigest: textoLimitado(corpo?.['digest'], LIMITE_DIGEST),
    clientStack: textoLimitado(corpo?.['stack'], LIMITE_PILHA),
    userId: session?.user.id ?? null,
    path: textoLimitado(request.headers.get('referer'), 2_000),
  });

  return new NextResponse(null, { status: 204 });
}
