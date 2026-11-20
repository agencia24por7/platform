import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import type { WorkerContext } from '@/shared/http/workerRoute';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import { consume } from '@/shared/security/rateLimit';
import { newRequestId } from '@/shared/security/tokens';
import type { Resposta } from '../application/brainService.ts';
import { etagCasa } from './etag.ts';

export const LIMITE_DE_LEITURAS_POR_MINUTO = 60;
const JANELA_MS = 60_000;

type Envelope<T> = { readonly etag: string; readonly corpo: T };
type RotaDoWorker = (request: NextRequest) => Promise<NextResponse>;
export type ParametrosBrutos = Readonly<Record<string, string>> | null;

export function comEtag<P, Q, T>(
  paramsSchema: z.ZodType<P>,
  brutos: ParametrosBrutos,
  executar: (params: P, query: Q, worker: WorkerContext) => Promise<Result<Resposta<T>, Failure>>,
) {
  return async (query: Q, worker: WorkerContext): Promise<Result<Envelope<T>, Failure>> => {
    if (!consume(`brain:${worker.callerFingerprint}`, LIMITE_DE_LEITURAS_POR_MINUTO, JANELA_MS).allowed) {
      return err(failure('rate_limited', 'Limite de leituras do catálogo excedido.'));
    }
    const params = brutos ? paramsSchema.safeParse(brutos) : null;
    if (!params?.success) return err(failure('not_found', 'Recurso não encontrado.'));
    const resultado = await executar(params.data, query, worker);
    return resultado.ok ? ok({ etag: resultado.value.etag, corpo: resultado.value.corpo }) : resultado;
  };
}

function decodificar(brutos: Record<string, string | string[]>): ParametrosBrutos {
  try {
    return Object.fromEntries(
      Object.entries(brutos).map(([chave, valor]) => [chave, decodeURIComponent(Array.isArray(valor) ? valor.join('/') : valor)]),
    );
  } catch {
    return null;
  }
}

export function rotaDeLeitura(rota: (params: ParametrosBrutos) => RotaDoWorker) {
  return async (request: NextRequest, contexto: { params: Promise<Record<string, string | string[]>> }): Promise<NextResponse> => {
    const resposta = await rota(decodificar(await contexto.params))(request);
    if (resposta.status !== 200) return resposta;
    const { etag, corpo } = (await resposta.json()) as Envelope<unknown>;
    const cabecalhos = {
      ETag: etag,
      'Cache-Control': 'private, no-cache',
      'X-Request-Id': resposta.headers.get('x-request-id') ?? newRequestId(),
    };
    if (etagCasa(request.headers.get('if-none-match'), etag)) return new NextResponse(null, { status: 304, headers: cabecalhos });
    return NextResponse.json(corpo, { status: 200, headers: cabecalhos });
  };
}
