import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { criarJanelaLimitada } from './janelaLimitada.ts';

function relogio(inicio = 0) {
  let agora = inicio;
  return { agora: () => agora, avancar: (ms: number) => void (agora += ms) };
}

describe('criarJanelaLimitada', () => {
  it('respeita o limite por chave dentro da janela', () => {
    const r = relogio();
    const janela = criarJanelaLimitada({ limite: 2, janelaMs: 1000, maxChaves: 10, agora: r.agora });
    assert.deepEqual([janela.permitir('a'), janela.permitir('a'), janela.permitir('a')], [true, true, false]);
    assert.equal(janela.permitir('b'), true);
  });

  it('libera de novo depois que a janela passa', () => {
    const r = relogio();
    const janela = criarJanelaLimitada({ limite: 1, janelaMs: 1000, maxChaves: 10, agora: r.agora });
    assert.equal(janela.permitir('a'), true);
    assert.equal(janela.permitir('a'), false);
    r.avancar(1001);
    assert.equal(janela.permitir('a'), true);
  });

  it('lotada, permite (fail-open) e avisa uma vez por janela', () => {
    const r = relogio();
    let avisos = 0;
    const janela = criarJanelaLimitada({ limite: 1, janelaMs: 1000, maxChaves: 2, agora: r.agora, aoLotar: () => void (avisos += 1) });
    janela.permitir('a');
    janela.permitir('b');
    assert.equal(janela.permitir('c'), true);
    assert.equal(janela.permitir('d'), true);
    assert.equal(avisos, 1);
    r.avancar(1001);
    assert.equal(janela.permitir('e'), true);
    assert.equal(janela.permitir('f'), true);
    assert.equal(janela.permitir('g'), true);
    assert.equal(avisos, 2);
  });

  it('recolhe chaves vencidas antes de considerar lotada', () => {
    const r = relogio();
    let avisos = 0;
    const janela = criarJanelaLimitada({ limite: 1, janelaMs: 1000, maxChaves: 2, agora: r.agora, aoLotar: () => void (avisos += 1) });
    janela.permitir('a');
    janela.permitir('b');
    r.avancar(1001);
    assert.equal(janela.permitir('c'), true);
    assert.equal(janela.permitir('c'), false);
    assert.equal(avisos, 0);
  });
});
