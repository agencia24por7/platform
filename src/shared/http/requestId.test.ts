import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CABECALHO_DO_REQUEST_ID, resolverRequestId } from './requestId.ts';

const GERADO = 'gerado-0000-0000';
const gerar = () => GERADO;

describe('resolverRequestId', () => {
  it('mantém um id válido', () => {
    assert.equal(resolverRequestId('abc12345-def6', gerar), 'abc12345-def6');
  });

  it('aceita o limite de 8 e de 64 caracteres', () => {
    assert.equal(resolverRequestId('a'.repeat(8), gerar), 'a'.repeat(8));
    assert.equal(resolverRequestId('a'.repeat(64), gerar), 'a'.repeat(64));
  });

  it('gera quando ausente ou vazio', () => {
    assert.equal(resolverRequestId(null, gerar), GERADO);
    assert.equal(resolverRequestId(undefined, gerar), GERADO);
    assert.equal(resolverRequestId('', gerar), GERADO);
  });

  it('rejeita curto e longo', () => {
    assert.equal(resolverRequestId('a'.repeat(7), gerar), GERADO);
    assert.equal(resolverRequestId('a'.repeat(65), gerar), GERADO);
  });

  it('rejeita quebra de linha, espaço, controle e unicode', () => {
    assert.equal(resolverRequestId('abcdefgh\n', gerar), GERADO);
    assert.equal(resolverRequestId('abcdefgh\nX-Forjado: 1', gerar), GERADO);
    assert.equal(resolverRequestId('abcd efgh', gerar), GERADO);
    assert.equal(resolverRequestId('abcdefgh\u0000', gerar), GERADO);
    assert.equal(resolverRequestId('abcdefgé', gerar), GERADO);
    assert.equal(resolverRequestId('abcdefg‮1', gerar), GERADO);
  });

  it('usa o gerador padrão quando nenhum é passado', () => {
    assert.match(resolverRequestId(null), /^[0-9a-f-]{36}$/);
  });

  it('expõe o nome do cabeçalho', () => {
    assert.equal(CABECALHO_DO_REQUEST_ID, 'x-request-id');
  });
});
