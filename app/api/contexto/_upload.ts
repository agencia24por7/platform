import { NextResponse } from 'next/server';
import type { LerConteudo } from '@/modules/clients/application/contextoService';
import { TAMANHO_MAXIMO_DO_ARQUIVO } from '@/modules/clients/domain/contexto/arquivos';
import {
  ENVIOS_SIMULTANEOS_POR_REPLICA,
  criarSemaforo,
  lerAteOLimite,
  lerPedidoDeEnvio,
  type MotivoDoPedido,
  type PedidoDeEnvio,
} from '@/modules/clients/domain/contexto/envio';
import { env } from '@/shared/config/env';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok } from '@/shared/result/result';

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

const MENSAGEM_DE_LIMITE = `O arquivo passa de ${Math.round(TAMANHO_MAXIMO_DO_ARQUIVO / (1024 * 1024))} MB.`;

const RESPOSTA_DO_MOTIVO: Readonly<Record<MotivoDoPedido, { readonly status: number; readonly erro: string }>> = {
  incompleto: { status: 400, erro: 'Pedido de envio incompleto.' },
  invalido: { status: 400, erro: 'Pedido de envio inválido.' },
  tamanho_ausente: { status: 411, erro: 'O envio precisa informar o tamanho do arquivo.' },
  acima_do_limite: { status: 413, erro: MENSAGEM_DE_LIMITE },
  vazio: { status: 400, erro: 'O arquivo está vazio.' },
};

const vagasDeEnvio = criarSemaforo(ENVIOS_SIMULTANEOS_POR_REPLICA);

export function responderErro(status: number, erro: string, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json({ ok: false, erro }, { status, headers: { ...SEM_CACHE, ...extra } });
}

export function responderFalha(falha: Failure): NextResponse {
  const extra: Record<string, string> = {};
  const espera = falha.details?.['retryAfterSeconds'];
  if (espera) extra['Retry-After'] = espera;
  const status = Number(falha.details?.['http']) || STATUS[falha.code] || 400;
  return responderErro(status, falha.message, extra);
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

export function descartarCorpo(request: Request): void {
  if (request.body && !request.bodyUsed) request.body.cancel().catch(() => undefined);
}

export type PedidoLidoDaRequisicao = { readonly ok: true; readonly pedido: PedidoDeEnvio } | { readonly ok: false; readonly resposta: NextResponse };

export function lerPedido(request: Request): PedidoLidoDaRequisicao {
  const lido = lerPedidoDeEnvio({
    campo: request.headers.get('x-campo'),
    lista: request.headers.get('x-lista'),
    item: request.headers.get('x-item'),
    nome: request.headers.get('x-nome'),
    tipo: request.headers.get('content-type'),
    tamanho: request.headers.get('content-length'),
  });
  if (lido.ok) return lido;
  const resposta = RESPOSTA_DO_MOTIVO[lido.motivo];
  return { ok: false, resposta: responderErro(resposta.status, resposta.erro) };
}

export function leitorDoCorpo(request: Request): LerConteudo {
  return async (esperado) => {
    const lido = await lerAteOLimite(request.body, esperado);
    if (lido.ok) return ok(lido.conteudo);
    return err(
      lido.motivo === 'acima_do_declarado'
        ? failure('validation', 'O envio passou do tamanho informado.', { http: '413' })
        : failure('validation', 'O envio chegou incompleto. Tente de novo.', { http: '400' }),
    );
  };
}

export async function comVagaDeEnvio(request: Request, trabalho: () => Promise<NextResponse>): Promise<NextResponse> {
  const liberar = vagasDeEnvio.tentar();
  if (!liberar) {
    descartarCorpo(request);
    return responderErro(429, 'Muitos envios ao mesmo tempo. Tente de novo em instantes.', { 'Retry-After': '5' });
  }
  try {
    return await trabalho();
  } finally {
    liberar();
  }
}
