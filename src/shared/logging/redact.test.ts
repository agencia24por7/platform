import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { redact, redactText } from './redact.ts';

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

test('o vocabulário em português também é redigido', () => {
  const redigido = redact({ chave: 'apify_api_segredo', senha: '123', segredo: 'x', credencial: 'y' }) as Record<string, unknown>;

  assert.equal(redigido['chave'], '[redigido]');
  assert.equal(redigido['senha'], '[redigido]');
  assert.equal(redigido['segredo'], '[redigido]');
  assert.equal(redigido['credencial'], '[redigido]');
});

test('chave do Apify é redigida mesmo solta no texto', () => {
  const texto = 'falhou ao usar apify_api_AbCdEf1234567890xyz no passo 3';
  assert.ok(!redactText(texto).includes('AbCdEf1234567890xyz'));
  assert.match(redactText(texto), /\[redigido\]/);
});
