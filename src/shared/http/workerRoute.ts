import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/shared/config/env';
import { comoWorker } from '@/shared/db/client';
import { logger } from '@/shared/logging/logger';
import { failure, type Failure } from '@/shared/result/failure';
import type { Result } from '@/shared/result/result';
import { consume } from '@/shared/security/rateLimit';
import { fingerprint, secureCompare } from '@/shared/security/tokens';
import { problem, success } from '@/shared/http/problem';
import { CABECALHO_DO_REQUEST_ID, resolverRequestId } from '@/shared/http/requestId';
import { CorpoAcimaDoLimite, declaradoAcimaDoLimite, lerCorpoLimitado } from '@/shared/http/corpoLimitado';

const MAX_BODY_BYTES = 1_000_000;

export type WorkerRouteOptions = { readonly maxBodyBytes?: number };
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

export type WorkerContext = {
  readonly requestId: string;
  readonly callerFingerprint: string;
  readonly sourceIp: string | null;
};

type Handler<I, O> = (input: I, context: WorkerContext) => Promise<Result<O, Failure>>;

function readBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : null;
}

export function workerRoute<I, O>(schema: z.ZodType<I>, handler: Handler<I, O>, successStatus = 200, options: WorkerRouteOptions = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  return (request: NextRequest): Promise<NextResponse> =>
    handle(request, schema, handler, successStatus, async () => {
      if (declaradoAcimaDoLimite(request.headers.get('content-length'), maxBodyBytes)) throw new CorpoAcimaDoLimite();
      const raw = await lerCorpoLimitado(request.body, maxBodyBytes);
      if (raw.length === 0) return {};
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        throw new MalformedJson();
      }
    });
}

class MalformedJson extends Error {}

function handle<I, O>(
  request: NextRequest,
  schema: z.ZodType<I>,
  handler: Handler<I, O>,
  successStatus: number,
  readPayload: () => unknown | Promise<unknown>,
): Promise<NextResponse> {
  return (async (): Promise<NextResponse> => {
    const requestId = resolverRequestId(request.headers.get(CABECALHO_DO_REQUEST_ID));
    const sourceIp = clientIp(request);

    const token = readBearer(request);
    if (!token || !secureCompare(token, env().TRIA_WORKER_TOKEN)) {
      logger.warn('worker.unauthorized', { requestId, path: request.nextUrl.pathname });
      return problem(failure('unauthorized', 'Credencial de worker ausente ou inválida.'), requestId);
    }

    const caller = fingerprint(token);
    const verdict = consume(`worker:${caller}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!verdict.allowed) {
      return NextResponse.json(
        { type: 'https://orla.app/problems/rate_limited', title: 'Limite de chamadas excedido.', status: 429, requestId },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds), 'X-Request-Id': requestId } },
      );
    }

    let payload: unknown;
    try {
      payload = await readPayload();
    } catch (error) {
      if (error instanceof CorpoAcimaDoLimite) {
        return NextResponse.json(
          { type: 'https://orla.app/problems/payload_too_large', title: 'Corpo da requisição acima do limite.', status: 413, requestId },
          { status: 413, headers: { 'Content-Type': 'application/problem+json', 'X-Request-Id': requestId } },
        );
      }
      return problem(failure('validation', 'Corpo não é JSON válido.'), requestId);
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const details = Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join('.') || '(raiz)', issue.message]),
      );
      return problem(failure('validation', 'Payload inválido.', details), requestId);
    }

    const context: WorkerContext = { requestId, callerFingerprint: caller, sourceIp };

    try {
      const result = await comoWorker(() => handler(parsed.data, context));
      if (!result.ok) return problem(result.error, requestId);
      return success(result.value, requestId, successStatus);
    } catch (error) {
      logger.error('worker.unhandled', {
        requestId,
        path: request.nextUrl.pathname,
        error: error instanceof Error ? error.message : 'desconhecido',
      });
      return problem(failure('unavailable', 'Falha inesperada ao processar a requisição.'), requestId);
    }
  })();
}

export function workerQueryRoute<I, O>(schema: z.ZodType<I>, handler: Handler<I, O>) {
  return (request: NextRequest): Promise<NextResponse> =>
    handle(request, schema, handler, 200, () =>
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
}
