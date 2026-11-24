import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

const executar = promisify(execFile);
const banco = process.env.REGRAS_REPO_DATABASE_URL;
const admin = process.env.REGRAS_REPO_ADMIN_URL;
const worker = process.env.REGRAS_MIGRACAO_WORKER_URL;

describe('regrasRepository contra Postgres real', { skip: !banco || !admin || !worker ? 'defina REGRAS_REPO_DATABASE_URL (papel orla_app), REGRAS_MIGRACAO_WORKER_URL (papel orla_worker) e REGRAS_REPO_ADMIN_URL (dono) de um Postgres descartável migrado' : false }, () => {
  it('cenário completo do repositório (inserção, superação, eventos, conflito, paginação, isolamento, teto atômico)', async () => {
    const { stdout } = await executar(
      process.execPath,
      ['--experimental-strip-types', 'tests/apoio/regrasRepositorioCenario.mjs'],
      { env: { ...process.env, DATABASE_URL: banco, DATABASE_URL_WORKER: worker, REGRAS_REPO_ADMIN_URL: admin }, timeout: 120_000 },
    );
    assert.match(stdout, /cenario ok/);
  });
});
