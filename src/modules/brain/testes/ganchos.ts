import { existsSync } from 'node:fs';
import * as modulo from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Resolver = (especificador: string, contexto: { parentURL?: string }, proximo: (especificador: string, contexto: unknown) => unknown) => unknown;
type ComGanchos = { registerHooks: (ganchos: { resolve: Resolver }) => void };

const RAIZ = process.cwd();
const arquivoTs = (base: string): string | null =>
  [base, `${base}.ts`, `${base}/index.ts`].find((candidato) => candidato.endsWith('.ts') && existsSync(candidato)) ?? null;

declare global {
  var __ganchosDoBrain: boolean | undefined;
}

if (!globalThis.__ganchosDoBrain) {
  globalThis.__ganchosDoBrain = true;
  (modulo as unknown as ComGanchos).registerHooks({
    resolve(especificador, contexto, proximo) {
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
}
