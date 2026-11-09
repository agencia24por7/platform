import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTA_UNICA,
  identidadeDaConexao,
  rotuloDaChave,
  usaChaveDeApi,
  validarChave,
} from './chaveDeApi.ts';

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

test('a identidade da conexão não deriva da chave', () => {
  const umaChave = 'apify_api_AAAAAAAAAAAAAAAAAAAAbbbb';
  const outraChave = 'apify_api_ZZZZZZZZZZZZZZZZZZZZbbbb';

  assert.equal(
    rotuloDaChave(umaChave),
    rotuloDaChave(outraChave),
    'duas chaves diferentes podem ter o mesmo apelido — por isso ele não serve de identidade',
  );

  assert.equal(identidadeDaConexao(), CONTA_UNICA);
  assert.ok(!identidadeDaConexao().includes('bbbb'), 'nenhum pedaço da chave na identidade');
});

test('trocar a chave renova a mesma conexão em vez de criar outra', () => {
  assert.equal(identidadeDaConexao(), identidadeDaConexao());
});
