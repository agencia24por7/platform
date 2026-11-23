import assert from 'node:assert/strict';
import test from 'node:test';
import { idsDoRecorte, membroSemAcessoAClientes, recorteDoFormulario, validarRecorte } from './recorte.ts';

const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

test('modo organizacao é válido e não carrega ids', () => {
  const recorte = recorteDoFormulario('organizacao', [ID])!;
  assert.equal(validarRecorte(recorte), null);
  assert.deepEqual(idsDoRecorte(recorte), []);
});

test('modo clientes com lista vazia é erro de validação', () => {
  assert.equal(validarRecorte({ modo: 'clientes', clientIds: [] }), 'recorte_vazio');
});

test('modo clientes recusa id malformado e deduplica', () => {
  assert.equal(validarRecorte({ modo: 'clientes', clientIds: ['x'] }), 'cliente_invalido');
  assert.deepEqual(idsDoRecorte({ modo: 'clientes', clientIds: [ID, ID] }), [ID]);
});

test('modo ausente ou desconhecido não vira organização inteira', () => {
  assert.equal(recorteDoFormulario('', []), null);
  assert.equal(recorteDoFormulario('tudo', []), null);
});

test('membro em modo clientes sem clientes vivos está sem acesso', () => {
  assert.equal(membroSemAcessoAClientes({ escopo: 'clientes', clientIds: [] }), true);
  assert.equal(membroSemAcessoAClientes({ escopo: 'clientes', clientIds: [ID] }), false);
  assert.equal(membroSemAcessoAClientes({ escopo: 'organizacao', clientIds: [] }), false);
});
