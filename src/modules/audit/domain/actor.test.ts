import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { primeiroEndereco } from './actor.ts';

describe('origem da requisição', () => {
  it('usa o primeiro endereço da cadeia, que é o cliente', () => {
    assert.equal(primeiroEndereco('189.89.237.149, 10.0.0.1'), '189.89.237.149');
  });

  it('aceita endereço único', () => {
    assert.equal(primeiroEndereco('189.89.237.149'), '189.89.237.149');
  });

  it('tira a porta de um endereço ipv4', () => {
    assert.equal(primeiroEndereco('189.89.237.149:51324'), '189.89.237.149');
  });

  it('preserva ipv6, que tem dois-pontos de verdade', () => {
    assert.equal(primeiroEndereco('2001:db8::1'), '2001:db8::1');
  });

  it('recusa ausência e lixo em vez de gravar sujeira na auditoria', () => {
    assert.equal(primeiroEndereco(null), null);
    assert.equal(primeiroEndereco(''), null);
    assert.equal(primeiroEndereco('   '), null);
    assert.equal(primeiroEndereco('<script>'), null);
  });

  it('recusa valor absurdamente longo', () => {
    assert.equal(primeiroEndereco('9'.repeat(60)), null);
  });
});
