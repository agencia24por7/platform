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

function opcional<T extends z.ZodTypeAny>(tipo: T) {
  return z.preprocess((valor) => (valor === '' ? undefined : valor), tipo.optional());
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().startsWith('postgres'),
  TRIA_WORKER_TOKEN: strongSecret,
  TRIA_SESSION_SECRET: strongSecret,
  TRIA_APP_BASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  GOOGLE_OAUTH_CLIENT_ID: opcional(z.string().min(10)),
  GOOGLE_OAUTH_CLIENT_SECRET: opcional(z.string().min(10)),
  META_APP_ID: opcional(z.string().min(5)),
  META_APP_SECRET: opcional(z.string().min(10)),
  META_LOGIN_CONFIG_ID: opcional(z.string().min(5)),
  WHATSAPP_LOGIN_CONFIG_ID: opcional(z.string().min(5)),
  LEADADS_LOGIN_CONFIG_ID: opcional(z.string().min(5)),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: opcional(z.string().min(20)),
  RDSTATION_CLIENT_ID: opcional(z.string().min(5)),
  RDSTATION_CLIENT_SECRET: opcional(z.string().min(10)),
  N8N_API_URL: opcional(z.string().url()),
  N8N_PUBLIC_URL: opcional(z.string().url()),
  N8N_OWNER_EMAIL: opcional(z.string().email()),
  N8N_OWNER_PASSWORD: opcional(z.string().min(8)),
  N8N_API_KEY: opcional(z.string().min(20)),
  BQ_PROJECT_ID: opcional(z.string().min(3)),
  BQ_DATASET: z.string().min(3).default('tria_dw'),
  BQ_MAXIMO_BYTES_FATURADOS: z.coerce.number().int().min(10_000_000).default(10_000_000_000),
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
