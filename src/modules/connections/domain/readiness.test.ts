import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CREDENCIAL_SEM_COFRE, readinessOf } from './connection.ts';

describe('prontidão da conexão', () => {
  it('coleta quando há credencial guardada e a autorização está viva', () => {
    const pronta = readinessOf({ status: 'active', credentialRef: 'n8n-credential-42' });
    assert.equal(pronta.collectable, true);
    assert.equal(pronta.reason, null);
  });

  it('não coleta sem credencial no cofre, mesmo marcada como ativa', () => {
    const sem = readinessOf({ status: 'active', credentialRef: CREDENCIAL_SEM_COFRE });
    assert.equal(sem.collectable, false);
    assert.match(sem.reason ?? '', /cofre/);
  });

  it('a ausência de credencial pesa mais que o estado', () => {
    for (const status of ['active', 'expiring', 'degraded'] as const) {
      assert.equal(readinessOf({ status, credentialRef: CREDENCIAL_SEM_COFRE }).collectable, false);
    }
  });

  it('não coleta quando a autorização foi revogada ou expirou', () => {
    assert.equal(readinessOf({ status: 'revoked', credentialRef: 'cred-1' }).collectable, false);
    assert.equal(readinessOf({ status: 'reauth_pending', credentialRef: 'cred-1' }).collectable, false);
    assert.equal(readinessOf({ status: 'degraded', credentialRef: 'cred-1' }).collectable, false);
  });

  it('expirando ainda coleta, porque o token continua válido', () => {
    assert.equal(readinessOf({ status: 'expiring', credentialRef: 'cred-1' }).collectable, true);
  });
});
