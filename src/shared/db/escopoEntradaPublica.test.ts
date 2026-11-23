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

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@127.0.0.1:1/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { origemDoEscopo } = await import('./escopo.ts');

const USUARIO_ALHEIO = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('M8: entrada pública ignora a sessão de outro usuário', () => {
  it('M8: em entrada pública o escopo é da organização do token, mesmo com cookie de sessão', () => {
    assert.equal(origemDoEscopo(USUARIO_ALHEIO, false, true), 'organizacao_inteira');
  });
});
