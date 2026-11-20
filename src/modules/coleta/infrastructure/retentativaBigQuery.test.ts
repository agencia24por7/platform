import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { comRetentativa, erroTransitorioDoBigQuery, esperaDaTentativa, POLITICA_PADRAO } from './retentativaBigQuery.ts';

const ambiente = (esperas: number[]) => ({ dormir: async (ms: number) => void esperas.push(ms), aleatorio: () => 1 });

describe('classificação de erro do BigQuery', () => {
  it('concorrência de DML e transação abortada são transitórias', () => {
    for (const message of [
      'Could not serialize access to table p:d.fato_x due to concurrent update',
      'Transaction is aborted due to concurrent update against table p.d.dim_y',
      'Too many DML statements outstanding against table p:d.t, limit is 20',
      'Exceeded rate limits: too many table update operations for this table',
    ]) {
      assert.equal(erroTransitorioDoBigQuery(new Error(message)), true, message);
    }
  });

  it('motivo e código HTTP transitórios também', () => {
    assert.equal(erroTransitorioDoBigQuery({ message: 'x', errors: [{ reason: 'rateLimitExceeded' }] }), true);
    assert.equal(erroTransitorioDoBigQuery({ message: 'x', errors: [{ reason: 'backendError' }] }), true);
    assert.equal(erroTransitorioDoBigQuery({ message: 'x', code: 503 }), true);
  });

  it('erro de SQL, de esquema ou de custo não é retentado', () => {
    assert.equal(erroTransitorioDoBigQuery(new Error('Syntax error: Unexpected keyword')), false);
    assert.equal(erroTransitorioDoBigQuery({ message: 'Query exceeded limit for bytes billed: 10000000000', errors: [{ reason: 'bytesBilledLimitExceeded' }] }), false);
    assert.equal(erroTransitorioDoBigQuery({ message: 'Required field data_dia cannot be null', code: 400 }), false);
    assert.equal(erroTransitorioDoBigQuery(null), false);
  });
});

describe('retentativa com espera exponencial', () => {
  it('a espera dobra até o teto, com jitter na metade de cima', () => {
    assert.deepEqual([1, 2, 3, 4, 6].map((tentativa) => esperaDaTentativa(tentativa, POLITICA_PADRAO, () => 1)), [500, 1000, 2000, 4000, 8000]);
    assert.equal(esperaDaTentativa(1, POLITICA_PADRAO, () => 0), 250);
  });

  it('repete erro transitório e devolve o resultado quando passa', async () => {
    const esperas: number[] = [];
    let chamadas = 0;
    const resultado = await comRetentativa(async () => {
      chamadas += 1;
      if (chamadas < 3) throw new Error('Transaction is aborted due to concurrent update');
      return 'ok';
    }, POLITICA_PADRAO, ambiente(esperas));
    assert.equal(resultado, 'ok');
    assert.equal(chamadas, 3);
    assert.deepEqual(esperas, [500, 1000]);
  });

  it('desiste depois do número de tentativas e repassa o último erro', async () => {
    let chamadas = 0;
    await assert.rejects(
      comRetentativa(async () => {
        chamadas += 1;
        throw new Error(`concurrent update ${chamadas}`);
      }, POLITICA_PADRAO, ambiente([])),
      /concurrent update 4/,
    );
    assert.equal(chamadas, 4);
  });

  it('erro não transitório falha na primeira', async () => {
    let chamadas = 0;
    await assert.rejects(comRetentativa(async () => {
      chamadas += 1;
      throw new Error('Syntax error');
    }, POLITICA_PADRAO, ambiente([])));
    assert.equal(chamadas, 1);
  });
});
