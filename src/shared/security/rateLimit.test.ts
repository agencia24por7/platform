import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { consume, consumeAll, forget } from './rateLimit.ts';

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

test('mapa cheio falha fechado e nunca despeja balde vivo', async () => {
  assert.ok(consume('vivo-antes-da-inundacao', 5, 60_000).allowed);

  for (let i = 0; i < 10_050; i++) consume(`inunda:${i}`, 1, 30);

  assert.ok(
    consume('vivo-antes-da-inundacao', 5, 60_000).allowed,
    'o balde que já existia precisa seguir contando durante a inundação',
  );

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(
    consume('novo-apos-vencerem', 1, 60_000).allowed,
    'vencidos recolhidos abrem espaço para balde novo',
  );

  forget('vivo-antes-da-inundacao');
  forget('novo-apos-vencerem');
});

test('a cobrança é tudo-ou-nada entre os baldes do mesmo pedido', () => {
  for (let i = 0; i < 3; i++) consumeAll([{ key: 'par:a', limit: 10 }, { key: 'par:b', limit: 3 }], 60_000);

  const barrado = consumeAll([{ key: 'par:a', limit: 10 }, { key: 'par:b', limit: 3 }], 60_000);
  assert.equal(barrado.allowed, false, 'o balde menor precisa barrar o pedido inteiro');

  const sozinho = consume('par:a', 10, 60_000);
  assert.equal(
    sozinho.remaining,
    10 - 3 - 1,
    'o balde maior tinha de estar em 3 quando o pedido barrado passou por ele: cobrado, estaria em 4 e a sobra seria menor',
  );

  forget('par:a');
  forget('par:b');
});
