import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { eOperadorDaPlataforma, listaDeOperadores } from './operador.ts';

const verificado = (email: string) => ({ email, emailVerificado: true });

describe('operador da plataforma (ADR 0043)', () => {
  it('variável ausente: ninguém é operador', () => {
    assert.equal(eOperadorDaPlataforma(verificado('a@x.com'), undefined), false);
  });

  it('variável vazia ou só com separadores: ninguém é operador', () => {
    assert.equal(eOperadorDaPlataforma(verificado('a@x.com'), ''), false);
    assert.equal(eOperadorDaPlataforma(verificado('a@x.com'), ' , ,, '), false);
    assert.deepEqual(listaDeOperadores(' , '), []);
  });

  it('compara sem diferença de caixa', () => {
    assert.equal(eOperadorDaPlataforma(verificado('Ana@X.com'), 'ana@x.COM'), true);
  });

  it('e-mail não verificado nunca é operador', () => {
    assert.equal(eOperadorDaPlataforma({ email: 'a@x.com', emailVerificado: false }, 'a@x.com'), false);
  });

  it('aceita lista com espaços', () => {
    assert.equal(eOperadorDaPlataforma(verificado('b@x.com'), ' a@x.com ,  b@x.com , c@x.com'), true);
    assert.equal(eOperadorDaPlataforma(verificado('d@x.com'), ' a@x.com ,  b@x.com '), false);
  });

  it('não casa por pedaço do endereço', () => {
    assert.equal(eOperadorDaPlataforma(verificado('a@x.com'), 'aa@x.com,a@x.com.br'), false);
  });
});
