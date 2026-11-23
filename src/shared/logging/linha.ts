import { redact } from './redact.ts';

export type Level = 'debug' | 'info' | 'warn' | 'error';

export function serializarLinha(
  level: Level,
  message: string,
  context?: Record<string, unknown>,
): string {
  const base = { level, message: String(message), at: new Date().toISOString() };
  if (!context) return JSON.stringify(base);
  try {
    const seguro = redact(context) as Record<string, unknown>;
    return JSON.stringify({ ...seguro, ...base });
  } catch {
    return JSON.stringify({ ...base, logError: 'contexto_ilegivel' });
  }
}
