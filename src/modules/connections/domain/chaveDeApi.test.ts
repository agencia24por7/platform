import assert from 'node:assert/strict';
import test from 'node:test';
import { rotuloDaChave, usaChaveDeApi, validarChave } from './chaveDeApi.ts';

test('só o Apify se conecta por chave', () => {
  assert.equal(usaChaveDeApi('apify'), true);
  assert.equal(usaChaveDeApi('google'), false);
  assert.equal(usaChaveDeApi('rdstation'), false);
});

test('chave com espaço é recusada antes de sair daqui', () => {
  assert.equal(validarChave('apify_api_abc def'), 'chave_com_espaco');
  assert.equal(validarChave('apify_api_abc\ndef'), 'chave_com_espaco');
});

test('chave curta demais não vira conexão', () => {
  assert.equal(validarChave('curta'), 'chave_curta');
  assert.equal(validarChave('a'.repeat(401)), 'chave_curta');
  assert.equal(validarChave('a'.repeat(40)), null);
});

test('o rótulo mostra as pontas e esconde o meio', () => {
  assert.equal(rotuloDaChave('apify_api_1234567890abcdef'), 'apif••••cdef');
  assert.equal(rotuloDaChave('curta'), '••••');
  assert.ok(!rotuloDaChave('apify_api_1234567890abcdef').includes('567890'));
});
