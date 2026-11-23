import { env } from '../config/env.ts';
import { serializarLinha, type Level } from './linha.ts';

const severity: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  try {
    if (severity[level] < severity[env().LOG_LEVEL]) return;
    const line = serializarLinha(level, message, context);
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  } catch {
    return;
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
