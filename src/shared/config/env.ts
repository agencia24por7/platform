import { z } from 'zod';

const MIN_SECRET_LENGTH = 32;

const forbiddenPlaceholders = ['changeme', 'secret', 'password', 'example', 'troque'];

const strongSecret = z
  .string()
  .min(MIN_SECRET_LENGTH, `precisa de ao menos ${MIN_SECRET_LENGTH} caracteres`)
  .refine(
    (value) => !forbiddenPlaceholders.some((word) => value.toLowerCase().includes(word)),
    'não pode conter palavra de exemplo',
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().startsWith('postgres'),
  TRIA_WORKER_TOKEN: strongSecret,
  TRIA_APP_BASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(10).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(10).optional(),
  META_APP_ID: z.string().min(5).optional(),
  META_APP_SECRET: z.string().min(10).optional(),
  META_LOGIN_CONFIG_ID: z.string().min(5).optional(),
  N8N_API_URL: z.string().url().optional(),
  N8N_API_KEY: z.string().min(20).optional(),
});

export type Env = z.infer<typeof schema>;

function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração inválida. O app não sobe sem isto:\n${problems}`);
  }

  return parsed.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}
