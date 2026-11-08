import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isWindowSane } from './syncRun.ts';

describe('isWindowSane', () => {
  it('aceita janela dentro do limite', () => {
    assert.ok(isWindowSane({ start: '2026-10-10', end: '2026-11-07' }, 90));
  });

  it('recusa janela invertida', () => {
    assert.ok(!isWindowSane({ start: '2026-11-07', end: '2026-10-10' }, 90));
  });

  it('recusa janela maior que o limite', () => {
    assert.ok(!isWindowSane({ start: '2020-01-01', end: '2026-01-01' }, 90));
  });

  it('recusa data inválida', () => {
    assert.ok(!isWindowSane({ start: 'ontem', end: '2026-01-01' }, 90));
  });

  it('aceita janela de um único dia', () => {
    assert.ok(isWindowSane({ start: '2026-11-07', end: '2026-11-07' }, 90));
  });
});
