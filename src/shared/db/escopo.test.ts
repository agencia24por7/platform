import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as modulo from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Resolver = (especificador: string, contexto: { parentURL?: string }, proximo: (especificador: string, contexto: unknown) => unknown) => unknown;
type ComGanchos = { registerHooks: (ganchos: { resolve: Resolver }) => void };

const RAIZ = process.cwd();
const arquivoTs = (base: string): string | null =>
  [base, `${base}.ts`, `${base}/index.ts`].find((candidato) => candidato.endsWith('.ts') && existsSync(candidato)) ?? null;

(modulo as unknown as ComGanchos).registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === 'next/headers') return proximo(pathToFileURL(resolve(RAIZ, 'node_modules/next/headers.js')).href, contexto);
    if (especificador.startsWith('@/')) {
      const alvo = arquivoTs(resolve(RAIZ, 'src', especificador.slice(2)));
      if (alvo) return proximo(pathToFileURL(alvo).href, contexto);
    }
    if (especificador.startsWith('.') && contexto.parentURL?.endsWith('.ts') && !/\.\w+$/.test(especificador)) {
      const alvo = arquivoTs(resolve(dirname(fileURLToPath(contexto.parentURL)), especificador));
      if (alvo) return proximo(pathToFileURL(alvo).href, contexto);
    }
    return proximo(especificador, contexto);
  },
});

process.env['DATABASE_URL'] ??= 'postgres://u:p@127.0.0.1:1/x';
process.env['TRIA_WORKER_TOKEN'] ??= 'worker-token-de-teste-com-mais-de-32-caracteres';
process.env['TRIA_SESSION_SECRET'] ??= 'segredo-de-teste-com-mais-de-32-caracteres';
process.env['TRIA_APP_BASE_URL'] ??= 'http://localhost:3000';

const { escopoDeCliente, ORGANIZACAO_INTEIRA, origemDoEscopo } = await import('./escopo.ts');
const { comoPublico, comoWorker } = await import('./client.ts');

const ORGANIZACAO = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('escopo sem sessão (D\')', () => {
  it('falha alto fora do worker e de entrada pública declarada', async () => {
    await assert.rejects(() => escopoDeCliente(ORGANIZACAO), /sem sessão/);
  });

  it('entrada pública declarada recebe a organização inteira', async () => {
    assert.equal(await comoPublico(() => escopoDeCliente(`${ORGANIZACAO}-pub`)), ORGANIZACAO_INTEIRA);
  });

  it('chamada do worker recebe a organização inteira', async () => {
    assert.equal(await comoWorker(() => escopoDeCliente(`${ORGANIZACAO}-wrk`)), ORGANIZACAO_INTEIRA);
  });

  it('a sessão sempre prevalece sobre o marcador público e o do worker', () => {
    const usuario = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    for (const worker of [false, true]) {
      for (const publico of [false, true]) {
        assert.equal(origemDoEscopo(usuario, worker, publico), 'usuario');
      }
    }
  });

  it('sem sessão só worker ou entrada pública recebem a organização inteira', () => {
    assert.equal(origemDoEscopo('', false, false), 'recusar');
    assert.equal(origemDoEscopo('', true, false), 'organizacao_inteira');
    assert.equal(origemDoEscopo('', false, true), 'organizacao_inteira');
  });
});
