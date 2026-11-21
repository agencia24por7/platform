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
  DATABASE_URL_WORKER: opcional(z.string().url().startsWith('postgres')),
  TRIA_WORKER_TOKEN: strongSecret,
  TRIA_SESSION_SECRET: strongSecret,
  META_EXCLUSAO_PEPPER: opcional(strongSecret),
  TRIA_APP_BASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_WORKER_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(20).default(5),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  BRAIN_LEITURAS_POR_MINUTO: opcional(z.coerce.number().int().min(10).max(10_000)),
  BRAIN_TETO_DE_LEITURAS_POR_MINUTO: opcional(z.coerce.number().int().min(10).max(50_000)),
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
  ALERT_WEBHOOK_URL: opcional(z.string().url().startsWith('https://')),
  BQ_PROJECT_ID: opcional(z.string().min(3)),
  BQ_DATASET: z.string().min(3).default('tria_dw'),
  CONTEXT_BUCKET: opcional(z.string().regex(/^[a-z0-9][a-z0-9._-]{2,221}$/, 'nome de bucket inválido')),
  BQ_MAXIMO_BYTES_FATURADOS: z.coerce.number().int().min(10_000_000).default(10_000_000_000),
  TOKENS_KMS_KEY: opcional(
    z.string().regex(/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/, 'nome de chave do KMS inválido'),
  ),
}).superRefine((valores, contexto) => {
  if (valores.NODE_ENV !== 'production') return;
  if (valores.META_APP_SECRET && !valores.META_EXCLUSAO_PEPPER) {
    contexto.addIssue({
      code: 'custom',
      path: ['META_EXCLUSAO_PEPPER'],
      message: 'obrigatória em produção com o callback de exclusão da Meta ligado (META_APP_SECRET), ADR 0033',
    });
  }
  if (valores.META_EXCLUSAO_PEPPER && valores.META_EXCLUSAO_PEPPER === valores.TRIA_SESSION_SECRET) {
    contexto.addIssue({ code: 'custom', path: ['META_EXCLUSAO_PEPPER'], message: 'precisa ser diferente de TRIA_SESSION_SECRET (ADR 0033)' });
  }
  if (!valores.DATABASE_URL_WORKER) {
    contexto.addIssue({ code: 'custom', path: ['DATABASE_URL_WORKER'], message: 'obrigatória em produção (papel orla_worker, ADR 0028)' });
    return;
  }
  if (usuarioDaUrl(valores.DATABASE_URL_WORKER) === usuarioDaUrl(valores.DATABASE_URL)) {
    contexto.addIssue({ code: 'custom', path: ['DATABASE_URL_WORKER'], message: 'precisa usar um papel diferente do DATABASE_URL (ADR 0028)' });
  }
});

export type Env = z.infer<typeof schema>;

function usuarioDaUrl(url: string): string {
  return decodeURIComponent(new URL(url).username);
}

export function urlDoBancoDoWorker(config: Pick<Env, 'DATABASE_URL' | 'DATABASE_URL_WORKER'>): string {
  return config.DATABASE_URL_WORKER ?? config.DATABASE_URL;
}

export function lerAmbiente(fonte: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(fonte);

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
  cached ??= lerAmbiente(process.env);
  return cached;
}
