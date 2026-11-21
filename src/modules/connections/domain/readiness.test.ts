import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { precisaReautorizar, readinessOf } from './connection.ts';

describe('prontidão da conexão', () => {
  it('coleta quando há token no cofre e a autorização está viva', () => {
    const pronta = readinessOf({ status: 'active', versaoDoToken: 1 });
    assert.equal(pronta.collectable, true);
    assert.equal(pronta.reason, null);
  });

  it('não coleta sem token no cofre, mesmo marcada como ativa', () => {
    const sem = readinessOf({ status: 'active', versaoDoToken: null });
    assert.equal(sem.collectable, false);
    assert.match(sem.reason ?? '', /cofre/);
    assert.match(sem.reason ?? '', /Reautorize/);
  });

  it('a ausência de token pesa mais que o estado', () => {
    for (const status of ['active', 'expiring', 'degraded', 'reauth_pending'] as const) {
      assert.equal(readinessOf({ status, versaoDoToken: null }).collectable, false);
    }
  });

  it('não coleta quando a autorização foi revogada ou expirou', () => {
    assert.equal(readinessOf({ status: 'revoked', versaoDoToken: null }).collectable, false);
    assert.equal(readinessOf({ status: 'reauth_pending', versaoDoToken: 3 }).collectable, false);
    assert.equal(readinessOf({ status: 'degraded', versaoDoToken: 3 }).collectable, false);
  });

  it('expirando ainda coleta, porque o token continua válido', () => {
    assert.equal(readinessOf({ status: 'expiring', versaoDoToken: 2 }).collectable, true);
  });

  it('pede reautorização para reauth_pending, degradada ou sem token; nunca para revogada', () => {
    assert.equal(precisaReautorizar({ status: 'reauth_pending', versaoDoToken: 1 }), true);
    assert.equal(precisaReautorizar({ status: 'active', versaoDoToken: null }), true);
    assert.equal(precisaReautorizar({ status: 'degraded', versaoDoToken: 1 }), true);
    assert.equal(precisaReautorizar({ status: 'active', versaoDoToken: 1 }), false);
    assert.equal(precisaReautorizar({ status: 'revoked', versaoDoToken: null }), false);
  });
});
