import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isJanelaSana } from './coleta.ts';

describe('isJanelaSana', () => {
  it('aceita janela dentro do limite', () => {
    assert.equal(isJanelaSana({ start: '2026-01-01', end: '2026-01-07' }, 28), true);
  });

  it('recusa fim antes do início', () => {
    assert.equal(isJanelaSana({ start: '2026-01-07', end: '2026-01-01' }, 28), false);
  });

  it('recusa janela maior que o limite', () => {
    assert.equal(isJanelaSana({ start: '2026-01-01', end: '2026-03-01' }, 28), false);
  });

  it('recusa data inválida', () => {
    assert.equal(isJanelaSana({ start: 'não-é-data', end: '2026-01-07' }, 28), false);
  });
});
