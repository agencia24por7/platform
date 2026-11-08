import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redact } from './redact.ts';

describe('redact', () => {
  it('esconde campos sensíveis por nome', () => {
    const result = redact({ token: 'abc', password: '123', credentialRef: 'n8n:x' }) as Record<string, unknown>;
    assert.equal(result.token, '[redigido]');
    assert.equal(result.password, '[redigido]');
    assert.equal(result.credentialRef, '[redigido]');
  });

  it('preserva campos comuns', () => {
    const result = redact({ clientId: 'c1', rows: 10 }) as Record<string, unknown>;
    assert.equal(result.clientId, 'c1');
    assert.equal(result.rows, 10);
  });

  it('desce em objetos aninhados', () => {
    const result = redact({ outer: { authorization: 'Bearer x' } }) as { outer: Record<string, unknown> };
    assert.equal(result.outer.authorization, '[redigido]');
  });

  it('percorre arrays', () => {
    const result = redact([{ secret: 's' }, { ok: 1 }]) as Record<string, unknown>[];
    assert.equal(result[0]!.secret, '[redigido]');
    assert.equal(result[1]!.ok, 1);
  });

  it('não quebra com null', () => {
    assert.equal(redact(null), null);
  });
});
