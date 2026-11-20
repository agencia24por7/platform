import { NextResponse } from 'next/server';
import type { NovoAnexo } from '@/modules/clients/application/contextoService';
import { TAMANHO_MAXIMO_DO_ARQUIVO } from '@/modules/clients/domain/contexto/arquivos';
import { env } from '@/shared/config/env';
import { declaradoAcimaDoLimite } from '@/shared/http/corpoLimitado';
import type { Failure } from '@/shared/result/failure';

const STATUS: Record<string, number> = {
  validation: 422,
  not_found: 404,
  conflict: 409,
  unauthorized: 401,
  forbidden: 403,
  rate_limited: 429,
  unavailable: 503,
};

const SEM_CACHE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export function responderErro(status: number, erro: string, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json({ ok: false, erro }, { status, headers: { ...SEM_CACHE, ...extra } });
}

export function responderFalha(falha: Failure): NextResponse {
  const extra: Record<string, string> = {};
  const espera = falha.details?.['retryAfterSeconds'];
  if (espera) extra['Retry-After'] = espera;
  return responderErro(STATUS[falha.code] ?? 400, falha.message, extra);
}

export function responderOk(corpo: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: true, ...corpo }, { headers: SEM_CACHE });
}

export function mesmaOrigem(request: Request): boolean {
  const origem = request.headers.get('origin');
  if (!origem) return false;
  try {
    return new URL(origem).origin === new URL(env().TRIA_APP_BASE_URL).origin;
  } catch {
    return false;
  }
}

async function lerBinarioLimitado(corpo: ReadableStream<Uint8Array> | null, limite: number): Promise<Uint8Array | null> {
  if (!corpo) return new Uint8Array();
  const leitor = corpo.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    pedacos.push(value);
  }
  const junto = new Uint8Array(total);
  let posicao = 0;
  for (const pedaco of pedacos) {
    junto.set(pedaco, posicao);
    posicao += pedaco.byteLength;
  }
  return junto;
}

function cabecalho(request: Request, nome: string): string | null {
  const bruto = request.headers.get(nome);
  if (!bruto) return null;
  try {
    const valor = decodeURIComponent(bruto).trim();
    return valor.length > 0 ? valor : null;
  } catch {
    return null;
  }
}

export type AnexoLido = { readonly ok: true; readonly anexo: NovoAnexo } | { readonly ok: false; readonly resposta: NextResponse };

export async function lerAnexo(request: Request): Promise<AnexoLido> {
  const declarado = request.headers.get('content-length');
  const mensagemDeLimite = `O arquivo passa de ${Math.round(TAMANHO_MAXIMO_DO_ARQUIVO / (1024 * 1024))} MB.`;
  if (declaradoAcimaDoLimite(declarado, TAMANHO_MAXIMO_DO_ARQUIVO)) {
    return { ok: false, resposta: responderErro(413, mensagemDeLimite) };
  }
  const fieldKey = cabecalho(request, 'x-campo');
  const nome = cabecalho(request, 'x-nome');
  if (!fieldKey || !nome || nome.length > 255) return { ok: false, resposta: responderErro(400, 'Pedido de envio incompleto.') };

  const conteudo = await lerBinarioLimitado(request.body, TAMANHO_MAXIMO_DO_ARQUIVO);
  if (!conteudo) return { ok: false, resposta: responderErro(413, mensagemDeLimite) };
  if (conteudo.byteLength === 0) return { ok: false, resposta: responderErro(400, 'O arquivo está vazio.') };
  if (declarado !== null && Number(declarado) !== conteudo.byteLength) {
    return { ok: false, resposta: responderErro(400, 'O envio chegou incompleto. Tente de novo.') };
  }

  return {
    ok: true,
    anexo: {
      fieldKey,
      listKey: cabecalho(request, 'x-lista'),
      itemId: cabecalho(request, 'x-item'),
      nome,
      mime: (request.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim(),
      conteudo,
    },
  };
}
