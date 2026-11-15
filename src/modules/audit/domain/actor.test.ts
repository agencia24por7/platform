import assert from 'node:assert/strict';
import test from 'node:test';
import { enderecoConfiavel } from './actor.ts';

test('o endereço confiável é o salto do nosso proxy, não o que o cliente alegou', () => {
  assert.equal(enderecoConfiavel('1.2.3.4, 10.0.0.9, 203.0.113.7'), '203.0.113.7');
  assert.equal(enderecoConfiavel('invasor-forjou-isto, 203.0.113.7'), '203.0.113.7');
  assert.equal(enderecoConfiavel(null), null);
  assert.equal(enderecoConfiavel('lixo!!!'), null);
});

test('aceita endereço único, sem vírgula nenhuma', () => {
  assert.equal(enderecoConfiavel('189.89.237.149'), '189.89.237.149');
});

test('tira a porta de um endereço ipv4', () => {
  assert.equal(enderecoConfiavel('10.0.0.9, 189.89.237.149:51324'), '189.89.237.149');
});

test('preserva ipv6, que tem dois-pontos de verdade', () => {
  assert.equal(enderecoConfiavel('10.0.0.9, 2001:db8::1'), '2001:db8::1');
});

test('recusa ausência e lixo em vez de gravar sujeira na auditoria', () => {
  assert.equal(enderecoConfiavel(''), null);
  assert.equal(enderecoConfiavel('   '), null);
  assert.equal(enderecoConfiavel('<script>'), null);
});

test('recusa valor absurdamente longo', () => {
  assert.equal(enderecoConfiavel('9'.repeat(60)), null);
});
