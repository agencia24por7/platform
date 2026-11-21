import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emBloco, emLinha, textoNeutro } from './dadoNoMarkdown.ts';

describe('dado do cliente no markdown', () => {
  it('em linha vira trecho de código com crases mais longas que as do valor', () => {
    assert.equal(emLinha('Acme'), '`Acme`');
    assert.equal(emLinha('a `b` c'), '``a `b` c``');
    assert.equal(emLinha('`x`'), '`` `x` ``');
    assert.equal(emLinha('# título\nnova linha'), '`# título nova linha`');
    assert.equal(emLinha('   '), '`—`');
  });

  it('bloco usa cerca maior que qualquer sequência de crases e tira caracteres de controle e bidi', () => {
    assert.deepEqual(emBloco('linha\n```\nfim'), ['````text', 'linha', '```', 'fim', '````']);
    assert.deepEqual(emBloco('a‮b\u0000c', '  '), ['  ```text', '  abc', '  ```']);
  });

  it('texto neutro escapa marcação e desarma links', () => {
    const neutro = textoNeutro('[clique](https://mal.example) # <b>|x|</b> www.mal.example');
    assert.ok(!neutro.includes('https://'));
    assert.ok(!/(^|[^\\])\[/.test(neutro));
    assert.ok(!/(^|[^\\])\|/.test(neutro));
    assert.ok(neutro.includes('www\\.mal'));
    assert.equal(textoNeutro('a\n\nb'), 'a b');
  });
});
