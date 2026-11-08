import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { failure, type Failure } from '@/shared/result/failure';
import type { Result } from '@/shared/result/result';
import { consume } from '@/shared/security/rateLimit';
import { fingerprint, newRequestId, secureCompare } from '@/shared/security/tokens';
import { problem, success } from '@/shared/http/problem';

const MAX_BODY_BYTES = 1_000_000;
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

export function workerRoute<I, O>(schema: z.ZodType<I>, handler: Handler<I, O>, successStatus = 200) {
  return (request: NextRequest): Promise<NextResponse> =>
    handle(request, schema, handler, successStatus, async () => {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) throw new PayloadTooLarge();
      if (raw.length === 0) return {};
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        throw new MalformedJson();
      }
    });
}

class PayloadTooLarge extends Error {}
class MalformedJson extends Error {}

function handle<I, O>(
  request: NextRequest,
  schema: z.ZodType<I>,
  handler: Handler<I, O>,
  successStatus: number,
  readPayload: () => unknown | Promise<unknown>,
): Promise<NextResponse> {
  return (async (): Promise<NextResponse> => {
    const requestId = request.headers.get('x-request-id') ?? newRequestId();
    const sourceIp = clientIp(request);

    const token = readBearer(request);
    if (!token || !secureCompare(token, env().TRIA_WORKER_TOKEN)) {
      logger.warn('worker.unauthorized', { requestId, sourceIp, path: request.nextUrl.pathname });
      return problem(failure('unauthorized', 'Credencial de worker ausente ou inválida.'), requestId);
    }

    const caller = fingerprint(token);
    const verdict = consume(`worker:${caller}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!verdict.allowed) {
      return NextResponse.json(
        { type: 'https://tria.app/problems/rate_limited', title: 'Limite de chamadas excedido.', status: 429, requestId },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds), 'X-Request-Id': requestId } },
      );
    }

    let payload: unknown;
    try {
      payload = await readPayload();
    } catch (error) {
      const message =
        error instanceof PayloadTooLarge
          ? 'Corpo da requisição acima do limite.'
          : 'Corpo não é JSON válido.';
      return problem(failure('validation', message), requestId);
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
      const result = await handler(parsed.data, context);
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
