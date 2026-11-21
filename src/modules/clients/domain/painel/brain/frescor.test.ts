import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { frescorPelaColeta } from './frescor.ts';

function arquivosDeCodigo(diretorio: string): string[] {
  return readdirSync(diretorio).flatMap((nome) => {
    const caminho = join(diretorio, nome);
    if (statSync(caminho).isDirectory()) return nome === 'node_modules' ? [] : arquivosDeCodigo(caminho);
    return /\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

describe('frescor pela última coleta', () => {
  it('classifica pela idade da coleta', () => {
    const agora = new Date('2026-11-20T12:00:00Z');
    assert.equal(frescorPelaColeta(null, agora), 'desconhecido');
    assert.equal(frescorPelaColeta(new Date('2026-11-20T00:00:00Z'), agora), 'fresco');
    assert.equal(frescorPelaColeta(new Date('2026-11-17T00:00:00Z'), agora), 'atrasado');
    assert.equal(frescorPelaColeta(new Date('2026-11-01T00:00:00Z'), agora), 'parado');
  });

  it('o exemplo de teste não está no caminho de produção', () => {
    const producao = [...arquivosDeCodigo('app'), ...arquivosDeCodigo('src')].filter((c) => !c.endsWith('exemploDeTeste.ts'));
    const importam = producao.filter((c) => /exemploDeTeste/.test(readFileSync(c, 'utf8')));
    assert.deepEqual(importam, []);
  });
});
