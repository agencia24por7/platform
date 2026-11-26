import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { criarAvisoDeWorkerNaoAutorizado } from './avisoDeWorkerNaoAutorizado.ts';

test('um laço anônimo com token inválido gera uma linha por janela, sem token nem hash', () => {
  let instante = 0;
  const valorSensivelDoTeste = randomUUID();
  const linhas: { evento: string; campos: Record<string, unknown> }[] = [];
  const avisar = criarAvisoDeWorkerNaoAutorizado({
    janelaMs: 60_000,
    agora: () => instante,
    escrever: (evento, campos) => linhas.push({ evento, campos }),
  });

  for (let i = 0; i < 500; i += 1) avisar({ requestId: `req-${i}`, path: '/api/v0/coleta/gravar', token: valorSensivelDoTeste } as never);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0]?.evento, 'worker.unauthorized');
  assert.deepEqual(linhas[0]?.campos, { requestId: 'req-0', path: '/api/v0/coleta/gravar', suprimidos: 0 });
  assert.equal(JSON.stringify(linhas).includes(valorSensivelDoTeste), false);

  instante += 60_001;
  avisar({ requestId: 'req-x', path: '/api/v0/tarefas' });
  assert.equal(linhas.length, 2);
  assert.deepEqual(linhas[1]?.campos, { requestId: 'req-x', path: '/api/v0/tarefas', suprimidos: 499 });
});
