import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { consume, forget } from './rateLimit.ts';

describe('consume', () => {
  it('libera até o limite e bloqueia depois', () => {
    const key = `teste-${Math.random()}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.ok(consume(key, 3, 60_000).allowed, `tentativa ${attempt} deveria passar`);
    }
    const blocked = consume(key, 3, 60_000);
    assert.ok(!blocked.allowed);
    assert.ok(blocked.retryAfterSeconds > 0);
    forget(key);
  });

  it('conta cada chave de forma independente', () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    consume(a, 1, 60_000);
    assert.ok(!consume(a, 1, 60_000).allowed);
    assert.ok(consume(b, 1, 60_000).allowed);
    forget(a);
    forget(b);
  });

  it('reabre depois da janela', async () => {
    const key = `janela-${Math.random()}`;
    assert.ok(consume(key, 1, 20).allowed);
    assert.ok(!consume(key, 1, 20).allowed);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(consume(key, 1, 20).allowed);
    forget(key);
  });

  it('informa quanto resta', () => {
    const key = `resta-${Math.random()}`;
    assert.equal(consume(key, 5, 60_000).remaining, 4);
    assert.equal(consume(key, 5, 60_000).remaining, 3);
    forget(key);
  });
});

test('o mapa de baldes não cresce sem teto', () => {
  for (let i = 0; i < 10_050; i++) consume(`inunda:${i}`, 1, 60_000);
  assert.ok(consume('inunda:novo', 1, 60_000).allowed, 'balde novo precisa caber mesmo sob inundação');
});
