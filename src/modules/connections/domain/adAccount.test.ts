import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidExternalId, normalizeExternalId, recusaParaDesvincularConta } from './adAccount.ts';

describe('normalizeExternalId', () => {
  it('prefixa act_ no Meta quando ausente', () => {
    assert.equal(normalizeExternalId('meta', '1234567890'), 'act_1234567890');
  });

  it('mantém act_ existente', () => {
    assert.equal(normalizeExternalId('meta', 'act_1234567890'), 'act_1234567890');
  });

  it('formata o id do Google com hífens', () => {
    assert.equal(normalizeExternalId('google', '1234567890'), '123-456-7890');
  });

  it('aceita o id do Google já formatado', () => {
    assert.equal(normalizeExternalId('google', '123-456-7890'), '123-456-7890');
  });

  it('ignora espaços em volta', () => {
    assert.equal(normalizeExternalId('google', '  123 456 7890 '), '123-456-7890');
  });
});

describe('isValidExternalId', () => {
  it('aceita formatos válidos', () => {
    assert.ok(isValidExternalId('meta', 'act_1234567890'));
    assert.ok(isValidExternalId('google', '123-456-7890'));
  });

  it('recusa plataforma trocada', () => {
    assert.ok(!isValidExternalId('google', 'act_1234567890'));
    assert.ok(!isValidExternalId('meta', '123-456-7890'));
  });

  it('recusa id curto demais', () => {
    assert.ok(!isValidExternalId('meta', 'act_123'));
    assert.ok(!isValidExternalId('google', '12-34-56'));
  });

  it('recusa injeção com caracteres extras', () => {
    assert.ok(!isValidExternalId('google', "123-456-7890'; DROP TABLE"));
    assert.ok(!isValidExternalId('meta', 'act_1234567890 OR 1=1'));
  });
});

describe('desvincular conta de anúncio', () => {
  it('operador desvincula conta vinculada', () => {
    assert.equal(recusaParaDesvincularConta('operator', { status: 'linked' }), null);
  });

  it('leitor não desvincula', () => {
    assert.equal(recusaParaDesvincularConta('viewer', { status: 'linked' })?.codigo, 'forbidden');
  });

  it('conta inexistente', () => {
    assert.equal(recusaParaDesvincularConta('admin', null)?.codigo, 'not_found');
  });

  it('conta já desvinculada', () => {
    assert.equal(recusaParaDesvincularConta('admin', { status: 'unlinked' })?.codigo, 'conflict');
  });
});

