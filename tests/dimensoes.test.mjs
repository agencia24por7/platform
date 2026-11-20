import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { BASE, appIsUp, workerHeaders } from './helpers.mjs';

function senhaDoApp() {
  return readFileSync('.env', 'utf8')
    .split('\n')
    .find((linha) => linha.startsWith('APP_DB_PASSWORD='))
    .slice('APP_DB_PASSWORD='.length);
}

const comoApp = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', '-e', `PGPASSWORD=${senhaDoApp()}`, 'orla-postgres',
     'psql', '-U', 'orla_app', '-h', '127.0.0.1', '-d', 'tria', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();

describe('dimensões SCD2', { concurrency: false }, () => {
  it('o papel do app lê o estado das dimensões atravessando tenants', () => {
    for (const funcao of ['dimensao_fontes', 'dimensao_clientes', 'dimensao_mudancas_de_posse']) {
      assert.match(comoApp(`SELECT count(*) FROM automation.${funcao}()`), /^\d+$/);
    }
  });

  it('conta de anúncio desvinculada sai sem cliente na dimensão', () => {
    const comCliente = comoApp(
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
