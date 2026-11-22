import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';
import { env, urlDoBancoDoWorker } from '@/shared/config/env';

export type Sql = postgres.Sql<Record<string, never>>;

declare global {
  var __triaSql: Sql | undefined;
  var __triaSqlWorker: Sql | undefined;
  var __triaChamadaDoWorker: AsyncLocalStorage<true> | undefined;
  var __triaChamadaPublica: AsyncLocalStorage<true> | undefined;
}

type Conexao = { readonly url: string; readonly max: number; readonly nome: string };

globalThis.__triaChamadaDoWorker ??= new AsyncLocalStorage<true>();
const chamadaDoWorker = globalThis.__triaChamadaDoWorker;

globalThis.__triaChamadaPublica ??= new AsyncLocalStorage<true>();
const chamadaPublica = globalThis.__triaChamadaPublica;

function create(conexao: Conexao): Sql {
  const config = env();
  return postgres(conexao.url, {
    max: conexao.max,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: true,
    onnotice: () => {},
    connection: {
      application_name: conexao.nome,
      statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
    },
  });
}

function sqlDaWeb(): Sql {
  const config = env();
  globalThis.__triaSql ??= create({ url: config.DATABASE_URL, max: config.DATABASE_MAX_CONNECTIONS, nome: 'orla-app' });
  return globalThis.__triaSql;
}

function sqlDoWorker(): Sql {
  const config = env();
  globalThis.__triaSqlWorker ??= create({
    url: urlDoBancoDoWorker(config),
    max: config.DATABASE_WORKER_MAX_CONNECTIONS,
    nome: 'orla-worker',
  });
  return globalThis.__triaSqlWorker;
}

export function comoWorker<T>(trabalho: () => Promise<T>): Promise<T> {
  return chamadaDoWorker.run(true, trabalho);
}

export function comoPublico<T>(trabalho: () => Promise<T>): Promise<T> {
  return chamadaPublica.run(true, trabalho);
}

export function emChamadaPublica(): boolean {
  return chamadaPublica.getStore() === true;
}

export function emChamadaDoWorker(): boolean {
  return chamadaDoWorker.getStore() === true;
}

export function sql(): Sql {
  return emChamadaDoWorker() ? sqlDoWorker() : sqlDaWeb();
}
