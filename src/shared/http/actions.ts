import { newRequestId } from '@/shared/security/tokens';
import type { Failure } from '@/shared/result/failure';

export type ActionState = { readonly error?: string; readonly fieldErrors?: Record<string, string> };

export function toActionState(failure: Failure): ActionState {
  return failure.details ? { error: failure.message, fieldErrors: failure.details } : { error: failure.message };
}

export function requestId(): string {
  return newRequestId();
}

export function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function optionalText(form: FormData, key: string): string | null {
  const value = text(form, key);
  return value.length > 0 ? value : null;
}

export function checkbox(form: FormData, key: string): boolean {
  return form.get(key) === 'on';
}

export function list(form: FormData, key: string): string[] {
  return form
    .getAll(key)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
