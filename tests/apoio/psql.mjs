import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PG_CONTAINER } from './pgContainer.mjs';

const VARIAVEL_DE_SENHA = {
  orla_app: 'APP_DB_PASSWORD',
  orla_worker: 'WORKER_DB_PASSWORD',
};

function valorDoEnv(chave) {
  const linha = readFileSync('.env', 'utf8')
    .split('\n')
    .find((candidata) => candidata.startsWith(`${chave}=`));
  if (linha === undefined) throw new Error(`variável ${chave} ausente em .env`);
  return linha.slice(chave.length + 1);
}

function argumentosDoRole(usuario) {
  if (usuario === 'postgres') return { ambiente: [], host: [], senha: undefined };
  const variavel = VARIAVEL_DE_SENHA[usuario];
  if (variavel === undefined) throw new Error(`role sem senha configurada para testes: ${usuario}`);
  return { ambiente: ['-e', 'PGPASSWORD'], host: ['-h', '127.0.0.1'], senha: valorDoEnv(variavel) };
}

export function psqlComoRole(usuario, sql, { pararNoErro = false } = {}) {
  const { ambiente, host, senha } = argumentosDoRole(usuario);
  const env = senha === undefined ? process.env : { ...process.env, PGPASSWORD: senha };
  const opcoes = pararNoErro ? ['-v', 'ON_ERROR_STOP=1'] : [];
  try {
    return execFileSync(
      'docker',
      ['exec', '-i', ...ambiente, PG_CONTAINER, 'psql', '-U', usuario, ...host, '-d', 'tria', ...opcoes, '-qtAc', sql],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env },
    ).trim();
  } catch (falha) {
    const stderr = String(falha.stderr ?? '');
    const erro = new Error(`psql como ${usuario} falhou: ${stderr.trim()}`);
    erro.stderr = stderr;
    erro.status = falha.status;
    throw erro;
  }
}

export const psqlComoDono = (sql) => psqlComoRole('postgres', sql);

export const primeiraLinha = (texto) => texto.split('\n')[0].trim();

export const sufixoUnico = () => randomUUID().slice(0, 8);

export const sufixoNumerico = () => String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, '0');

export const psqlComoApp = (sql) => psqlComoRole('orla_app', sql);

export const psqlComoWorker = (sql) => psqlComoRole('orla_worker', sql);

export const psqlDonoPrimeiraLinha = (sql) => primeiraLinha(psqlComoDono(sql));
