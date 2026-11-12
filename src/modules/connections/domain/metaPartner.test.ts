import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizarContaDeAnuncioMeta } from './metaPartner.ts';

test('aceita o id já no formato act_', () => {
  assert.equal(normalizarContaDeAnuncioMeta('act_1234567890'), 'act_1234567890');
});

test('adiciona o prefixo quando vem só o número', () => {
  assert.equal(normalizarContaDeAnuncioMeta('1234567890'), 'act_1234567890');
});

test('aceita maiúsculas e espaço nas pontas', () => {
  assert.equal(normalizarContaDeAnuncioMeta('  ACT_1234567890  '), 'act_1234567890');
});

test('recusa formato inválido', () => {
  assert.equal(normalizarContaDeAnuncioMeta('não é um id'), null);
  assert.equal(normalizarContaDeAnuncioMeta('act_'), null);
  assert.equal(normalizarContaDeAnuncioMeta(''), null);
});
