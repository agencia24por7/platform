import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';

delete process.env.BQ_PROJECT_ID;
process.env.DATABASE_URL = 'postgres://app@localhost:5432/tria';
process.env.TRIA_WORKER_TOKEN = 'w'.repeat(40);
process.env.TRIA_SESSION_SECRET = 's'.repeat(40);
process.env.TRIA_APP_BASE_URL = 'http://localhost:3000';

const { createBigQueryGravador } = await import('./bigQueryGravador.ts');

describe('gravador BigQuery sem BQ_PROJECT_ID', () => {
  it('fica indisponível e recusa gravar sem tocar o BigQuery', async () => {
    const gravador = createBigQueryGravador();

    assert.equal(gravador.available, false);
    const resultado = await gravador.gravar('meta', [], {} as never);
    assert.deepEqual(resultado, { ok: false, motivo: 'bigquery_indisponivel' });
  });
});
