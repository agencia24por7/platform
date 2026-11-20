import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VAULT_PREFIX, credentialIdOf, descartarCredencial, semCredencialNoCofre } from '../application/credentialVault.ts';

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

describe('referência sem credencial no cofre', () => {
  it('reconhece referência pendente e descartada como nada a apagar', () => {
    assert.equal(semCredencialNoCofre('pendente:cofre-indisponivel'), true);
    assert.equal(semCredencialNoCofre('pendente:qualquer-coisa'), true);
    assert.equal(semCredencialNoCofre('descartada'), true);
  });

  it('não confunde referência real, vazia ou parecida', () => {
    assert.equal(semCredencialNoCofre(`${VAULT_PREFIX}JTn1jkruz6Gt2Iay`), false);
    assert.equal(semCredencialNoCofre(''), false);
    assert.equal(semCredencialNoCofre('descartada2'), false);
    assert.equal(semCredencialNoCofre('x-pendente:y'), false);
  });

  it('descartar referência sem credencial devolve descartada sem chamar o cofre', async () => {
    let chamadas = 0;
    const cofre = {
      available: true,
      store: async () => '',
      discard: async () => {
        chamadas += 1;
        return 'falhou' as const;
      },
    };
    assert.equal(await descartarCredencial(cofre, 'pendente:cofre-indisponivel'), 'descartada');
    assert.equal(await descartarCredencial(cofre, 'descartada'), 'descartada');
    assert.equal(chamadas, 0);
    assert.equal(await descartarCredencial(cofre, `${VAULT_PREFIX}JTn1jkruz6Gt2Iay`), 'falhou');
    assert.equal(chamadas, 1);
  });
});
