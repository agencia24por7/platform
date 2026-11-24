import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BASE, appIsUp, workerHeaders } from './helpers.mjs';
import { psqlComoApp as comoApp, psqlComoWorker as comoWorker } from './apoio/psql.mjs';

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
