import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redact, redactText } from './redact.ts';

const LIMITE_MS = 250;
const REPETICOES = 200_000;

const ENTRADAS_PATOLOGICAS: Record<string, string> = {
  'e-mail com hífens': 'a-'.repeat(REPETICOES),
  'e-mail com pontos': 'a.'.repeat(REPETICOES),
  'jwt sem ponto': 'eyJ'.repeat(REPETICOES),
  'prefixo ya29 repetido': 'ya29'.repeat(REPETICOES),
  'bearer com espaços': `Bearer${' '.repeat(REPETICOES)}`,
  'bearer repetido': 'Bearer '.repeat(REPETICOES),
  'chave json aberta': '"access_token"'.repeat(REPETICOES),
};

function medirMs(trabalho: () => unknown): number {
  const inicio = process.hrtime.bigint();
  trabalho();
  return Number(process.hrtime.bigint() - inicio) / 1_000_000;
}

describe('redação com entrada patológica', () => {
  for (const [nome, entrada] of Object.entries(ENTRADAS_PATOLOGICAS)) {
    it(`redactText termina rápido: ${nome}`, () => {
      assert.ok(medirMs(() => redactText(entrada)) < LIMITE_MS);
    });

    it(`redact de Error termina rápido: ${nome}`, () => {
      const erro = new Error(entrada);
      erro.stack = entrada;
      assert.ok(medirMs(() => redact(erro)) < LIMITE_MS);
    });

    it(`redact de string termina rápido: ${nome}`, () => {
      assert.ok(medirMs(() => redact({ texto: entrada })) < LIMITE_MS);
    });
  }

  it('mantém a redação normal de e-mail', () => {
    assert.equal(redactText('fulano@exemplo.com.br'), 'f***@exemplo.com.br');
    assert.equal(redactText('contato: ana.silva+x@sub.exemplo.org!'), 'contato: a***@sub.exemplo.org!');
  });

  it('mantém o corte da pilha', () => {
    const erro = new Error('x');
    erro.stack = 'linha\n'.repeat(1000);
    const saida = redact(erro) as { stack: string };
    assert.ok(saida.stack.length <= 2000);
  });
});
