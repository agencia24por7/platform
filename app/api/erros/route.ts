import { NextResponse } from 'next/server';
import { currentUser } from '@/shared/http/currentUser';
import { consume } from '@/shared/security/rateLimit';
import { enderecoConfiavel } from '@/modules/audit/domain/actor';
import { logger } from '@/shared/logging/logger';
import { redactText } from '@/shared/logging/redact';

export const dynamic = 'force-dynamic';

const LIMITE_MENSAGEM = 2_000;
const LIMITE_PILHA = 8_000;
const LIMITE_DIGEST = 200;
const LIMITE_CORPO_BYTES = 32_000;

async function corpoAteOLimite(request: Request): Promise<string | null> {
  const fluxo = request.body;
  if (!fluxo) return null;

  const leitor = fluxo.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > LIMITE_CORPO_BYTES) {
        await leitor.cancel();
        return null;
      }
      pedacos.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(total);
  let posicao = 0;
  for (const pedaco of pedacos) {
    bytes.set(pedaco, posicao);
    posicao += pedaco.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

function textoLimpo(valor: unknown, limite: number): string | null {
  if (typeof valor !== 'string' || valor.length === 0) return null;
  return redactText(valor.slice(0, limite));
}

function caminhoDaOrigem(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).pathname;
  } catch {
    return null;
  }
}

const RELATOS_POR_MINUTO = 10;
const RELATOS_GLOBAIS_POR_MINUTO = 120;

export async function POST(request: Request): Promise<NextResponse> {
  const origem = enderecoConfiavel(request.headers.get('x-forwarded-for')) ?? 'desconhecida';
  if (!consume(`erros:${origem}`, RELATOS_POR_MINUTO, 60_000).allowed) {
    return new NextResponse(null, { status: 429 });
  }

  if (!consume('erros:todos', RELATOS_GLOBAIS_POR_MINUTO, 60_000).allowed) {
    return new NextResponse(null, { status: 429 });
  }

  const bruto = await corpoAteOLimite(request);
  if (bruto === null) return new NextResponse(null, { status: 413 });

  let corpo: Record<string, unknown> | null = null;
  try {
    corpo = JSON.parse(bruto) as Record<string, unknown>;
  } catch {
    corpo = null;
  }

  const session = await currentUser();

  logger.error('client.erro', {
    clientMessage: textoLimpo(corpo?.['message'], LIMITE_MENSAGEM),
    clientDigest: textoLimpo(corpo?.['digest'], LIMITE_DIGEST),
    clientStack: textoLimpo(corpo?.['stack'], LIMITE_PILHA),
    userId: session?.user.id ?? null,
    path: caminhoDaOrigem(request.headers.get('referer')),
  });

  return new NextResponse(null, { status: 204 });
}
