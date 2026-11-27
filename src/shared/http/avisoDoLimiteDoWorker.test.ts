import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarAvisoDoLimiteDoWorker } from './avisoDoLimiteDoWorker.ts';

const dados = (retryAfterSeconds: number) => ({ requestId: 'req-1', path: '/api/v0/coleta/gravar', callerFingerprint: 'abcd1234', retryAfterSeconds });

test('um worker em laço gera uma linha por janela, com o mesmo evento e os campos sem dado pessoal', () => {
  let instante = 0;
  const linhas: { evento: string; campos: Record<string, unknown> }[] = [];
  const avisar = criarAvisoDoLimiteDoWorker({
    janelaMs: 60_000,
    agora: () => instante,
    escrever: (evento, campos) => linhas.push({ evento, campos }),
  });

  for (let i = 0; i < 500; i += 1) avisar(dados(30));
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0]?.evento, 'worker.limite_excedido');
  assert.deepEqual(linhas[0]?.campos, { ...dados(30), suprimidos: 0 });

  instante += 60_001;
  avisar(dados(12));
  assert.equal(linhas.length, 2);
  assert.deepEqual(linhas[1]?.campos, { ...dados(12), suprimidos: 499 });
});
