import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeMetadata } from './metadata.ts';

describe('normalização do metadado', () => {
  it('devolve objeto intacto', () => {
    const objeto = { platform: 'google', discoveredAccounts: 0 };
    assert.deepEqual(normalizeMetadata(objeto), objeto);
  });

  it('desembrulha linha antiga gravada como string json', () => {
    const antigo = '{"platform":"google","vaultAvailable":false}';
    assert.deepEqual(normalizeMetadata(antigo), { platform: 'google', vaultAvailable: false });
  });

  it('desembrulha string duplamente codificada', () => {
    const duplo = JSON.stringify(JSON.stringify({ platform: 'meta' }));
    assert.deepEqual(normalizeMetadata(JSON.parse(duplo)), { platform: 'meta' });
  });

  it('nunca deixa uma string virar colunas de caracteres', () => {
    const quebrado = normalizeMetadata('isto não é json');
    assert.deepEqual(Object.keys(quebrado), ['valor']);
    assert.equal(quebrado['valor'], 'isto não é json');
  });

  it('trata nulo, indefinido e vazio sem explodir', () => {
    assert.deepEqual(normalizeMetadata(undefined), {});
    assert.deepEqual(normalizeMetadata(null), { valor: null });
    assert.deepEqual(normalizeMetadata({}), {});
  });

  it('embrulha array, que não tem chaves nomeadas', () => {
    assert.deepEqual(normalizeMetadata([1, 2]), { valor: [1, 2] });
  });

  it('embrulha número e booleano em vez de enumerá-los', () => {
    assert.deepEqual(normalizeMetadata(7), { valor: 7 });
    assert.deepEqual(normalizeMetadata(true), { valor: true });
  });
});
