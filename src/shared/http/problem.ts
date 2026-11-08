import { NextResponse } from 'next/server';
import { httpStatusFor, type Failure } from '@/shared/result/failure';

export type ProblemBody = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Record<string, string>;
  requestId: string;
};

export function problem(failure: Failure, requestId: string): NextResponse<ProblemBody> {
  const status = httpStatusFor(failure.code);
  const body: ProblemBody = {
    type: `https://tria.app/problems/${failure.code}`,
    title: failure.message,
    status,
    requestId,
  };
  if (failure.details) body.errors = failure.details;

  return NextResponse.json(body, {
    status,
    headers: { 'Content-Type': 'application/problem+json', 'X-Request-Id': requestId },
  });
}

export function success<T>(data: T, requestId: string, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status, headers: { 'X-Request-Id': requestId } });
}
