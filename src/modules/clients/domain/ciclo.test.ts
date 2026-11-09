import assert from 'node:assert/strict';
import test from 'node:test';
import { coletaSegue, ehSituacao, mudancaPermitida } from './ciclo.ts';

test('quem só enxerga não muda a situação', () => {
  assert.equal(mudancaPermitida('viewer', 'paused'), 'sem_permissao');
});

test('quem opera pausa e reativa, mas não arquiva', () => {
  assert.equal(mudancaPermitida('operator', 'paused'), null);
  assert.equal(mudancaPermitida('operator', 'active'), null);
  assert.equal(mudancaPermitida('operator', 'archived'), 'arquivar_exige_admin');
});

test('quem administra arquiva', () => {
  assert.equal(mudancaPermitida('admin', 'archived'), null);
  assert.equal(mudancaPermitida('owner', 'archived'), null);
});

test('situação desconhecida é recusada antes de olhar o papel', () => {
  assert.equal(mudancaPermitida('viewer', 'excluido'), 'situacao_invalida');
  assert.equal(ehSituacao('excluido'), false);
});

test('só o cliente ativo segue coletando', () => {
  assert.equal(coletaSegue('active'), true);
  assert.equal(coletaSegue('paused'), false);
  assert.equal(coletaSegue('archived'), false);
});
