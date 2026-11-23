import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { BASE, appIsUp, workerHeaders } from './helpers.mjs';
import { PG_CONTAINER } from './apoio/pgContainer.mjs';

function senhaDoApp() {
  return readFileSync('.env', 'utf8')
    .split('\n')
    .find((linha) => linha.startsWith('APP_DB_PASSWORD='))
    .slice('APP_DB_PASSWORD='.length);
}

const comoApp = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', '-e', `PGPASSWORD=${senhaDoApp()}`, PG_CONTAINER,
     'psql', '-U', 'orla_app', '-h', '127.0.0.1', '-d', 'tria', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();

function senhaDoWorker() {
  return readFileSync('.env', 'utf8')
    .split('\n')
    .find((linha) => linha.startsWith('WORKER_DB_PASSWORD='))
    .slice('WORKER_DB_PASSWORD='.length);
}

const comoWorker = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', '-e', `PGPASSWORD=${senhaDoWorker()}`, PG_CONTAINER,
     'psql', '-U', 'orla_worker', '-h', '127.0.0.1', '-d', 'tria', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();

describe('dimensões SCD2', { concurrency: false }, () => {
  it('só o papel do worker lê o estado das dimensões atravessando tenants (ADR 0028)', () => {
    for (const funcao of ['dimensao_fontes', 'dimensao_clientes', 'dimensao_mudancas_de_posse']) {
      assert.match(comoWorker(`SELECT count(*) FROM automation.${funcao}()`), /^\d+$/);
      assert.throws(() => comoApp(`SELECT count(*) FROM automation.${funcao}()`), /permission denied/);
    }
  });

  it('conta de anúncio desvinculada sai sem cliente na dimensão', () => {
    const comCliente = comoWorker(
      `SELECT count(*) FROM automation.dimensao_fontes() WHERE origem = 'ad_account' AND status = 'unlinked' AND client_id IS NOT NULL`,
    );
    assert.equal(comCliente, '0');
  });

  it('a sincronização roda pela rota de worker, só com o token do worker', async () => {
    assert.ok(await appIsUp(), 'App não está no ar');
    const semToken = await fetch(`${BASE}/api/v0/manutencao/dimensoes`, { method: 'POST', body: '{}' });
    assert.equal(semToken.status, 401);

    const resposta = await fetch(`${BASE}/api/v0/manutencao/dimensoes`, {
      method: 'POST',
      headers: workerHeaders(),
      body: '{}',
    });
    assert.ok([200, 503].includes(resposta.status), `status inesperado ${resposta.status}`);
  });
});
