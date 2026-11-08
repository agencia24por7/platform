export const FailureCode = {
  Validation: 'validation',
  NotFound: 'not_found',
  Conflict: 'conflict',
  Unauthorized: 'unauthorized',
  Forbidden: 'forbidden',
  RateLimited: 'rate_limited',
  Unavailable: 'unavailable',
} as const;

export type FailureCode = (typeof FailureCode)[keyof typeof FailureCode];

export type Failure = {
  readonly code: FailureCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string>>;
};

export function failure(code: FailureCode, message: string, details?: Record<string, string>): Failure {
  return details ? { code, message, details } : { code, message };
}

const statusByCode: Record<FailureCode, number> = {
  validation: 422,
  not_found: 404,
  conflict: 409,
  unauthorized: 401,
  forbidden: 403,
  rate_limited: 429,
  unavailable: 503,
};

export function httpStatusFor(code: FailureCode): number {
  return statusByCode[code];
}
