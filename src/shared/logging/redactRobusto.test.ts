import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redact } from './redact.ts';
import { serializarLinha } from './linha.ts';

describe('redact robusto', () => {
  it('não estoura a pilha com referência circular', () => {
    const circular: Record<string, unknown> = { nome: 'x' };
    circular['self'] = circular;
    const saida = redact(circular) as Record<string, unknown>;
    assert.equal(saida['nome'], 'x');
    assert.equal(saida['self'], '[circular]');
  });

  it('limita a profundidade', () => {
    let fundo: Record<string, unknown> = { folha: 'x' };
    for (let i = 0; i < 40; i += 1) fundo = { filho: fundo };
    assert.doesNotThrow(() => JSON.stringify(redact(fundo)));
    assert.match(JSON.stringify(redact(fundo)), /\[profundo\]/);
  });

  it('preserva nome e mensagem de Error, sem vazar segredo na mensagem', () => {
    const erro = new Error('falhou com Bearer abcDEF123456xyz');
    const saida = redact({ err: erro }) as { err: Record<string, string> };
    assert.equal(saida.err['name'], 'Error');
    assert.ok(!saida.err['message']?.includes('abcDEF123456xyz'));
    assert.ok(!saida.err['stack']?.includes('abcDEF123456xyz'));
  });

  it('converte bigint e Date em valores serializáveis', () => {
    const saida = redact({ n: 10n, quando: new Date('2026-01-02T03:04:05Z') }) as Record<string, unknown>;
    assert.equal(saida['n'], '10');
    assert.equal(saida['quando'], '2026-01-02T03:04:05.000Z');
  });

  it('redige cookie, cpf e jwt por nome', () => {
    const saida = redact({ cookie: 'a=b', cpf: '1', jwt: 'x', 'set-cookie': 'z' }) as Record<string, unknown>;
    for (const valor of Object.values(saida)) assert.equal(valor, '[redigido]');
  });
});

describe('serializarLinha', () => {
  it('nunca lança, mesmo com contexto hostil', () => {
    const hostil: Record<string, unknown> = {};
    hostil['self'] = hostil;
    Object.defineProperty(hostil, 'explode', {
      enumerable: true,
      get() {
        throw new Error('getter hostil');
      },
    });
    let linha = '';
    assert.doesNotThrow(() => {
      linha = serializarLinha('error', 'falha', hostil);
    });
    assert.doesNotThrow(() => JSON.parse(linha));
    assert.equal((JSON.parse(linha) as { message: string }).message, 'falha');
  });
});
