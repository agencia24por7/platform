import postgres from 'postgres';
import { env } from '@/shared/config/env';

export type Sql = postgres.Sql<Record<string, never>>;

declare global {
  var __triaSql: Sql | undefined;
}

function create(): Sql {
  const config = env();
  return postgres(config.DATABASE_URL, {
    max: config.DATABASE_MAX_CONNECTIONS,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: true,
    onnotice: () => {},
    connection: {
      application_name: 'orla-app',
      statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
    },
  });
}

export function sql(): Sql {
  globalThis.__triaSql ??= create();
  return globalThis.__triaSql;
}
