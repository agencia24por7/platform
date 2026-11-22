import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const RAIZ = join(import.meta.dirname, '..', '..');
const IMPORTACAO = /^import\s+(type\s+)?([^;]*?)from\s+'([^']+)'/gms;
const SO_TIPOS_EM_CHAVES = /^\s*\{\s*(type\s+\w+\s*,?\s*)+\}\s*$/;
const CAMADA_DE_INFRAESTRUTURA = new RegExp('infrastructure/');

function arquivos(pasta: string): string[] {
  return readdirSync(join(RAIZ, pasta), { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) return arquivos(caminho);
    return entrada.name.endsWith('.ts') && !entrada.name.endsWith('.test.ts') ? [caminho] : [];
  });
}

function importacoes(caminho: string) {
  const texto = readFileSync(join(RAIZ, caminho), 'utf8');
  return [...texto.matchAll(IMPORTACAO)].map((m) => ({
    soTipo: Boolean(m[1]) || SO_TIPOS_EM_CHAVES.test(m[2]!),
    origem: m[3]!,
  }));
}

describe('camadas dos módulos', () => {
  const modulos = arquivos('src/modules');

  it('application só importa infrastructure como tipo', () => {
    const aplicacao = modulos.filter((c) => c.includes('/application/'));
    assert.ok(aplicacao.length > 0);
    const violacoes = aplicacao.flatMap((c) =>
      importacoes(c)
        .filter((i) => CAMADA_DE_INFRAESTRUTURA.test(i.origem) && !i.soTipo)
        .map((i) => `${c} -> ${i.origem}`),
    );
    assert.deepEqual(violacoes, []);
  });
});
