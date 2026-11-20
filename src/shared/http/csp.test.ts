import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { novoNonce, politicaDeSeguranca } from './csp.ts';

const diretiva = (politica: string, nome: string) =>
  politica.split('; ').find((parte) => parte.startsWith(`${nome} `)) ?? '';

describe('política de segurança de conteúdo', () => {
  it('em produção, script só com nonce e strict-dynamic, sem unsafe-inline nem unsafe-eval', () => {
    const scripts = diretiva(politicaDeSeguranca('abc123', false), 'script-src');
    assert.equal(scripts, "script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it('em desenvolvimento, só acrescenta unsafe-eval (exigido pelo React dev), nunca unsafe-inline', () => {
    const scripts = diretiva(politicaDeSeguranca('abc123', true), 'script-src');
    assert.ok(scripts.includes("'unsafe-eval'"));
    assert.ok(!scripts.includes("'unsafe-inline'"));
  });

  it('mantém as travas de enquadramento, base, formulário e objeto', () => {
    const politica = politicaDeSeguranca('n', false);
    for (const esperado of ["frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"]) {
      assert.ok(politica.includes(esperado), esperado);
    }
  });

  it('gera um nonce novo e imprevisível a cada chamada', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => novoNonce()));
    assert.equal(nonces.size, 50);
    for (const nonce of nonces) assert.match(nonce, /^[A-Za-z0-9+/=]{40,}$/);
  });
});
