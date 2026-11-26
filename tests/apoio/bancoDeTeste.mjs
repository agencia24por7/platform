import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { PG_CONTAINER } from './pgContainer.mjs';

const executar = promisify(execFile);

export function variavel(nome) {
  if (process.env[nome]) return process.env[nome];
  const linha = readFileSync('.env', 'utf8')
    .split('\n')
    .find((candidata) => candidata.startsWith(`${nome}=`));
  if (linha === undefined) throw new Error(`variável ${nome} ausente no ambiente e em .env`);
  return linha.slice(nome.length + 1);
}

export function enderecoDoPostgres() {
  try {
    const porta = execFileSync('docker', ['port', PG_CONTAINER, '5432/tcp'], { encoding: 'utf8' }).split('\n')[0].trim();
    return porta === '' ? null : porta.replace(/^0\.0\.0\.0|^\[::\]/, '127.0.0.1');
  } catch {
    return null;
  }
}

export function urlsDoBanco() {
  const app = process.env.BRAIN_REPO_DATABASE_URL;
  const worker = process.env.BRAIN_REPO_WORKER_URL;
  const admin = process.env.BRAIN_REPO_ADMIN_URL ?? null;
  if (app && worker) return { app, worker, admin };
  const host = enderecoDoPostgres();
  if (host === null) return null;
  const url = (usuario, senha) => `postgres://${usuario}:${encodeURIComponent(senha)}@${host}/tria`;
  return { app: url('orla_app', variavel('APP_DB_PASSWORD')), worker: url('orla_worker', variavel('WORKER_DB_PASSWORD')), admin };
}

const literal = (valor) => {
  if (valor === null || valor === undefined) return 'NULL';
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  return `'${String(valor).replaceAll("'", "''")}'`;
};

export function donoPorDocker() {
  return Object.assign(
    async (partes, ...valores) => {
      const consulta = partes.reduce((texto, parte, i) => texto + parte + (i < valores.length ? literal(valores[i]) : ''), '');
      const { stdout } = await executar('docker', [
        'exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', 'tria', '-v', 'ON_ERROR_STOP=1', '-qtAc',
        `WITH t AS (${consulta}) SELECT coalesce(json_agg(t), '[]'::json) FROM t`,
      ]);
      return JSON.parse(stdout.trim());
    },
    { end: async () => undefined },
  );
}
