import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

const RAIZ = join(import.meta.dirname, '..', '..', '..');

function arquivos(pasta: string): string[] {
  return readdirSync(join(RAIZ, pasta), { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) return entrada.name === 'node_modules' ? [] : arquivos(caminho);
    return /\.(ts|tsx|mjs)$/.test(entrada.name) && !/\.test\.ts$/.test(entrada.name) ? [caminho] : [];
  });
}

const fontes = [...arquivos('src'), ...arquivos('app')].map((caminho) => ({
  caminho: relative(RAIZ, join(RAIZ, caminho)),
  texto: readFileSync(join(RAIZ, caminho), 'utf8'),
}));

describe('fronteira do papel do worker (ADR 0028)', () => {
  it('só o workerRoute entra no contexto do worker', () => {
    const usam = fontes.filter((f) => /\bcomoWorker\b/.test(f.texto)).map((f) => f.caminho).sort();
    assert.deepEqual(usam, ['src/shared/db/client.ts', 'src/shared/http/workerRoute.ts']);
  });

  it('toda rota /api/v0 passa pelo workerRoute', () => {
    const rotas = fontes.filter((f) => f.caminho.startsWith('app/api/v0/') && f.caminho.endsWith('route.ts'));
    assert.ok(rotas.length > 0);
    const fora = rotas.filter((f) => !/worker(Query)?Route\(/.test(f.texto)).map((f) => f.caminho);
    assert.deepEqual(fora, []);
  });

  it('nenhuma rota fora de /api/v0 usa o workerRoute', () => {
    const fora = fontes
      .filter((f) => f.caminho.startsWith('app/') && !f.caminho.startsWith('app/api/v0/'))
      .filter((f) => /worker(Query)?Route\(/.test(f.texto))
      .map((f) => f.caminho);
    assert.deepEqual(fora, []);
  });
});
