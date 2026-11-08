import { env } from '@/shared/config/env';
import { redact } from '@/shared/logging/redact';

type Level = 'debug' | 'info' | 'warn' | 'error';

const severity: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  if (severity[level] < severity[env().LOG_LEVEL]) return;

  const line = JSON.stringify({
    level,
    message,
    at: new Date().toISOString(),
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  });

  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
