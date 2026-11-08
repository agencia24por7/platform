import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VAULT_PREFIX, credentialIdOf } from '../application/credentialVault.ts';

describe('referência de credencial', () => {
  it('extrai o id de uma referência válida', () => {
    assert.equal(credentialIdOf(`${VAULT_PREFIX}JTn1jkruz6Gt2Iay`), 'JTn1jkruz6Gt2Iay');
  });

  it('recusa referência de credencial que nunca foi guardada', () => {
    assert.equal(credentialIdOf('pendente:cofre-indisponivel'), null);
  });

  it('recusa id que não parece id, para não mandar lixo ao cofre', () => {
    assert.equal(credentialIdOf(`${VAULT_PREFIX}curto`), null);
    assert.equal(credentialIdOf(`${VAULT_PREFIX}`), null);
  });

  it('recusa tentativa de sair do caminho do recurso', () => {
    assert.equal(credentialIdOf(`${VAULT_PREFIX}../../workflows`), null);
    assert.equal(credentialIdOf(`${VAULT_PREFIX}abc/def`), null);
    assert.equal(credentialIdOf(`${VAULT_PREFIX}abc?x=1`), null);
  });

  it('recusa referência vazia', () => {
    assert.equal(credentialIdOf(''), null);
  });
});
