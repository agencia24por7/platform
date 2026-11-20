import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CorpoAcimaDoLimite, declaradoAcimaDoLimite, lerCorpoLimitado } from './corpoLimitado.ts';

function fluxo(pedacos: readonly string[]): { corpo: ReadableStream<Uint8Array>; lidos: () => number; cancelado: () => boolean } {
  let indice = 0;
  let cancelado = false;
  const corpo = new ReadableStream<Uint8Array>({
    pull(controle) {
      if (indice >= pedacos.length) return controle.close();
      controle.enqueue(new TextEncoder().encode(pedacos[indice]!));
      indice += 1;
    },
    cancel() {
      cancelado = true;
    },
  });
  return { corpo, lidos: () => indice, cancelado: () => cancelado };
}

describe('Content-Length declarado', () => {
  it('recusa antes de ler quando o declarado passa do limite', () => {
    assert.equal(declaradoAcimaDoLimite('1001', 1000), true);
    assert.equal(declaradoAcimaDoLimite('1000', 1000), false);
  });

  it('sem cabeçalho deixa a leitura limitada decidir; valor inválido recusa', () => {
    assert.equal(declaradoAcimaDoLimite(null, 10), false);
    assert.equal(declaradoAcimaDoLimite('', 10), false);
    assert.equal(declaradoAcimaDoLimite('abc', 10), true);
    assert.equal(declaradoAcimaDoLimite('-1', 10), true);
  });
});

describe('leitura limitada do corpo', () => {
  it('lê o corpo inteiro dentro do limite', async () => {
    assert.equal(await lerCorpoLimitado(fluxo(['{"a":', '1}']).corpo, 100), '{"a":1}');
  });

  it('corpo ausente é vazio', async () => {
    assert.equal(await lerCorpoLimitado(null, 100), '');
  });

  it('para de ler e cancela o fluxo assim que passa do limite, sem bufferizar o resto', async () => {
    const f = fluxo(['x'.repeat(60), 'y'.repeat(60), 'z'.repeat(60), 'w'.repeat(60)]);
    await assert.rejects(lerCorpoLimitado(f.corpo, 100), CorpoAcimaDoLimite);
    assert.ok(f.lidos() <= 3);
    assert.equal(f.cancelado(), true);
  });

  it('conta bytes, não caracteres', async () => {
    await assert.rejects(lerCorpoLimitado(fluxo(['é'.repeat(6)]).corpo, 10), CorpoAcimaDoLimite);
  });
});
