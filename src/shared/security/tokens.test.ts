import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fingerprint, newRequestId, secureCompare } from './tokens.ts';

describe('secureCompare', () => {
  it('aceita valores iguais', () => {
    assert.ok(secureCompare('a'.repeat(64), 'a'.repeat(64)));
  });

  it('recusa valores diferentes', () => {
    assert.ok(!secureCompare('a'.repeat(64), 'b'.repeat(64)));
  });

  it('recusa sem estourar quando os comprimentos diferem', () => {
    assert.doesNotThrow(() => secureCompare('curto', 'a'.repeat(64)));
    assert.ok(!secureCompare('curto', 'a'.repeat(64)));
  });

  it('recusa prefixo do valor correto', () => {
    const token = 'f'.repeat(64);
    assert.ok(!secureCompare(token.slice(0, 63), token));
  });

  it('recusa string vazia', () => {
    assert.ok(!secureCompare('', 'a'.repeat(64)));
  });
});

describe('fingerprint', () => {
  it('é estável e curto', () => {
    const value = 'token-de-teste';
    assert.equal(fingerprint(value), fingerprint(value));
    assert.equal(fingerprint(value).length, 12);
  });

  it('não devolve o valor original', () => {
    const value = 'segredo-que-nao-pode-vazar';
    assert.ok(!fingerprint(value).includes(value));
  });

  it('separa valores distintos', () => {
    assert.notEqual(fingerprint('a'), fingerprint('b'));
  });
});

describe('newRequestId', () => {
  it('não repete', () => {
    const ids = new Set(Array.from({ length: 500 }, newRequestId));
    assert.equal(ids.size, 500);
  });
});
