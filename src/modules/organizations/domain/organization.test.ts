import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { connectionReadiness, isReadyToCollect, slugify } from './organization.ts';

describe('slugify', () => {
  it('remove acentos e normaliza separadores', () => {
    assert.equal(slugify('Agência Ação & Cia'), 'agencia-acao-cia');
  });

  it('não deixa hífen nas pontas', () => {
    assert.equal(slugify('  --Operação--  '), 'operacao');
  });

  it('limita o comprimento', () => {
    assert.ok(slugify('a'.repeat(120)).length <= 50);
  });

  it('devolve vazio quando não sobra caractere válido', () => {
    assert.equal(slugify('@@@'), '');
  });

  it('preserva números', () => {
    assert.equal(slugify('Agência 24 7'), 'agencia-24-7');
  });
});

describe('connectionReadiness', () => {
  it('aponta falta de autorização antes de tudo', () => {
    assert.deepEqual(connectionReadiness({ connections: 0, linkedAccounts: 0 }), ['sem_conexao']);
  });

  it('aponta autorização sem conta escolhida', () => {
    assert.deepEqual(connectionReadiness({ connections: 1, linkedAccounts: 0 }), ['sem_conta']);
  });

  it('não aponta nada quando há conta vinculada', () => {
    assert.deepEqual(connectionReadiness({ connections: 1, linkedAccounts: 2 }), []);
  });
});

describe('isReadyToCollect', () => {
  it('exige autorização e ao menos uma conta', () => {
    assert.ok(isReadyToCollect({ connections: 1, linkedAccounts: 1 }));
    assert.ok(!isReadyToCollect({ connections: 1, linkedAccounts: 0 }));
    assert.ok(!isReadyToCollect({ connections: 0, linkedAccounts: 5 }));
  });
});
