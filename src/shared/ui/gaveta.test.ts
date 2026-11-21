import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deveFecharAGaveta } from './gaveta.ts';

const elemento = (dentroDeLink: boolean) => ({ closest: (seletor: string) => (seletor === 'a[href]' && dentroDeLink ? {} : null) });

describe('gaveta de navegação no celular', () => {
  it('fecha no véu e em qualquer link, inclusive o da página atual', () => {
    const gaveta = {};
    assert.equal(deveFecharAGaveta(gaveta, gaveta), true);
    assert.equal(deveFecharAGaveta(elemento(true), gaveta), true);
  });

  it('não fecha em clique fora de link dentro da gaveta', () => {
    assert.equal(deveFecharAGaveta(elemento(false), {}), false);
    assert.equal(deveFecharAGaveta(null, {}), false);
    assert.equal(deveFecharAGaveta(elemento(true), null), false);
  });
});
