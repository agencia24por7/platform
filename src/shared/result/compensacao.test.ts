import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { executarComCompensacao } from './compensacao.ts';

describe('executarComCompensacao', () => {
  it('não compensa quando a ação dá certo', async () => {
    let compensou = 0;
    const valor = await executarComCompensacao(async () => 42, async () => {
      compensou += 1;
    });
    assert.equal(valor, 42);
    assert.equal(compensou, 0);
  });

  it('compensa uma vez e repassa o erro original quando a ação falha', async () => {
    let compensou = 0;
    const falha = new Error('insert falhou');
    await assert.rejects(
      executarComCompensacao(async () => {
        throw falha;
      }, async () => {
        compensou += 1;
      }),
      (erro) => erro === falha,
    );
    assert.equal(compensou, 1);
  });

  it('se a compensação também falhar, o erro que sobe continua sendo o original', async () => {
    const falha = new Error('insert falhou');
    await assert.rejects(
      executarComCompensacao(async () => {
        throw falha;
      }, async () => {
        throw new Error('descarte falhou');
      }),
      (erro) => erro === falha,
    );
  });
});
