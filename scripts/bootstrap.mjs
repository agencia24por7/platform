import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');

if (existsSync(envPath)) {
  console.error('Arquivo de ambiente já existe. Apague-o manualmente para gerar segredos novos.');
  process.exit(1);
}

const secret = () => randomBytes(32).toString('hex');

const values = {
  POSTGRES_DB: 'tria',
  POSTGRES_PORT: '5432',
  POSTGRES_SUPERUSER: 'postgres',
  POSTGRES_SUPERUSER_PASSWORD: secret(),
  APP_DB_PASSWORD: secret(),
  WORKER_DB_PASSWORD: secret(),
  N8N_PORT: '5678',
  N8N_DB_PASSWORD: secret(),
  N8N_ENCRYPTION_KEY: secret(),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  TRIA_WORKER_TOKEN: secret(),
  TRIA_SESSION_SECRET: secret(),
  META_EXCLUSAO_PEPPER: secret(),
  N8N_API_URL: 'http://127.0.0.1:5678',
  N8N_PUBLIC_URL: 'http://localhost:5678',
  N8N_OWNER_EMAIL: '',
  N8N_OWNER_PASSWORD: '',
  N8N_API_KEY: '',
  GOOGLE_OAUTH_CLIENT_ID: '',
  GOOGLE_OAUTH_CLIENT_SECRET: '',
  LOG_LEVEL: 'info',
  NODE_ENV: 'development',
};

values.DATABASE_URL = `postgres://orla_app:${values.APP_DB_PASSWORD}@127.0.0.1:${values.POSTGRES_PORT}/${values.POSTGRES_DB}`;
values.DATABASE_URL_WORKER = `postgres://orla_worker:${values.WORKER_DB_PASSWORD}@127.0.0.1:${values.POSTGRES_PORT}/${values.POSTGRES_DB}`;

const order = [
  'POSTGRES_DB', 'POSTGRES_PORT', 'POSTGRES_SUPERUSER', 'POSTGRES_SUPERUSER_PASSWORD',
  'APP_DB_PASSWORD', 'WORKER_DB_PASSWORD',
  'N8N_PORT', 'N8N_DB_PASSWORD', 'N8N_ENCRYPTION_KEY',
  'DATABASE_URL', 'DATABASE_URL_WORKER', 'TRIA_APP_BASE_URL', 'TRIA_WORKER_TOKEN', 'TRIA_SESSION_SECRET',
  'META_EXCLUSAO_PEPPER',
  'N8N_API_URL', 'N8N_PUBLIC_URL', 'N8N_OWNER_EMAIL', 'N8N_OWNER_PASSWORD', 'N8N_API_KEY',
  'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
  'LOG_LEVEL', 'NODE_ENV',
];

writeFileSync(envPath, order.map((key) => `${key}=${values[key]}`).join('\n') + '\n', { mode: 0o600 });
chmodSync(envPath, 0o600);

console.log('Ambiente criado com segredos aleatórios, permissão 600, fora do versionamento.');
