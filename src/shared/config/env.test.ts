import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lerAmbiente, urlDoBancoDoWorker } from './env.ts';

const SEGREDO = 'a'.repeat(40);

const base = {
  DATABASE_URL: 'postgres://orla_app:senha@postgres:5432/tria',
  TRIA_WORKER_TOKEN: SEGREDO,
  TRIA_SESSION_SECRET: `${SEGREDO}b`,
  TRIA_APP_BASE_URL: 'https://app.local',
};

describe('conexão do worker', () => {
  it('em desenvolvimento, sem DATABASE_URL_WORKER, cai no DATABASE_URL', () => {
    const config = lerAmbiente({ ...base, NODE_ENV: 'development' });
    assert.equal(urlDoBancoDoWorker(config), base.DATABASE_URL);
  });

  it('em teste também aceita a ausência', () => {
    const config = lerAmbiente({ ...base, NODE_ENV: 'test', DATABASE_URL_WORKER: '' });
    assert.equal(urlDoBancoDoWorker(config), base.DATABASE_URL);
  });

  it('em produção, sem DATABASE_URL_WORKER, o app não sobe', () => {
    assert.throws(() => lerAmbiente({ ...base, NODE_ENV: 'production' }), /DATABASE_URL_WORKER/);
  });

  it('em produção, recusa o mesmo papel da web', () => {
    assert.throws(
      () => lerAmbiente({ ...base, NODE_ENV: 'production', DATABASE_URL_WORKER: 'postgres://orla_app:outra@postgres:5432/tria' }),
      /papel diferente/,
    );
  });

  it('em produção, com o papel do worker, usa a conexão dele', () => {
    const url = 'postgres://orla_worker:s%40nha@postgres:5432/tria';
    const config = lerAmbiente({ ...base, NODE_ENV: 'production', DATABASE_URL_WORKER: url });
    assert.equal(urlDoBancoDoWorker(config), url);
    assert.equal(config.DATABASE_WORKER_MAX_CONNECTIONS, 5);
  });
});
