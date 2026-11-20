import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve as resolverCaminho } from 'node:path';

const RAIZ = resolverCaminho(import.meta.dirname, '..', '..');

function arquivoDoAlias(especificador) {
  const base = resolverCaminho(RAIZ, especificador.slice(2));
  const candidatos = [base, `${base}.ts`, `${base}/index.ts`].filter((candidato) => candidato.endsWith('.ts'));
  return candidatos.find((candidato) => existsSync(candidato));
}

export async function resolve(especificador, contexto, proximo) {
  if (especificador.startsWith('@/')) {
    const arquivo = arquivoDoAlias(especificador);
    if (arquivo) return { url: pathToFileURL(arquivo).href, shortCircuit: true };
  }
  return proximo(especificador, contexto);
}
