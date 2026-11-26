import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarAvisoLimitado } from './avisoLimitado.ts';

test('emite no máximo um aviso por janela e conta os suprimidos', () => {
  let instante = 0;
  const emitidos: { suprimidos: number }[] = [];
  const avisar = criarAvisoLimitado({ janelaMs: 60_000, agora: () => instante, emitir: (c) => emitidos.push({ ...c }) });

  for (let i = 0; i < 1_200; i += 1) avisar();
  assert.deepEqual(emitidos, [{ suprimidos: 0 }]);

  instante += 59_999;
  avisar();
  assert.equal(emitidos.length, 1);

  instante += 2;
  avisar();
  assert.deepEqual(emitidos, [{ suprimidos: 0 }, { suprimidos: 1_200 }]);
});
