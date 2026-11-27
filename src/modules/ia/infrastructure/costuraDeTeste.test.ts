import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../../brain/testes/ganchos.ts');
const { comCatalogoDeTeste, comModeloDeTeste } = await import('./costuraDeTeste.ts');
const { ok } = await import('../../../shared/result/result.ts');

const real = { listar: async () => ok(['modelo-real']) };
const fabricaReal = () => ({ real: true }) as never;
const LOCAL = { NODE_ENV: 'development', TRIA_APP_BASE_URL: 'http://localhost:3000' };
const NOME_DE_CHAVE_FICTICIO = ['projects', 'p', 'locations', 'l', 'keyRings', 'k', 'cryptoKeys', 'c'].join('/');

describe('costura de teste da IA só existe fora de produção', () => {
  it('em produção, com KMS ou com endereço público devolve o catálogo e a fábrica reais, sem embrulho', () => {
    for (const ambiente of [
      { NODE_ENV: 'production', TRIA_APP_BASE_URL: 'http://localhost:3000' },
      { ...LOCAL, TOKENS_KMS_KEY: NOME_DE_CHAVE_FICTICIO },
      { NODE_ENV: 'development', TRIA_APP_BASE_URL: 'https://app.exemplo.com' },
    ]) {
      assert.equal(comCatalogoDeTeste(real as never, ambiente), real);
      assert.equal(comModeloDeTeste(fabricaReal, ambiente), fabricaReal);
    }
  });

  it('em ambiente local, chave que não tem o prefixo de teste segue para o fornecedor real', async () => {
    const catalogo = comCatalogoDeTeste(real as never, LOCAL);
    assert.deepEqual(await catalogo.listar('google', 'chave-real-do-fornecedor-0123456789'), { ok: true, value: ['modelo-real'] });
    const fabrica = comModeloDeTeste(fabricaReal, LOCAL);
    assert.deepEqual(fabrica({ fornecedor: 'google', modelo: 'm', chave: 'chave-real-do-fornecedor-0123456789' }), { real: true });
  });
});
