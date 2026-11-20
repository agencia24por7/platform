import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diferencas, diferencasDeDados, instantaneo } from './diff.ts';
import { entrada, item } from './fixturesDeTeste.ts';

describe('diferenças entre versões do contexto', () => {
  it('detecta campo adicionado, alterado e removido', () => {
    const antes = instantaneo({ campos: [entrada('segmento', 'moda'), entrada('cidade', 'Recife')], itens: [] });
    const depois = instantaneo({ campos: [entrada('segmento', 'moda praia'), entrada('site', 'https://x.com')], itens: [] });
    const mudancas = diferencas(antes, depois).map((d) => (d.tipo === 'campo' ? `${d.fieldKey}:${d.mudanca}` : ''));
    assert.deepEqual(mudancas, ['cidade:removido', 'segmento:alterado', 'site:adicionado']);
  });

  it('compara itens por id, campo a campo, ignorando ordem de chaves', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const antes = instantaneo({ campos: [], itens: [item('produtos', { nome: 'A', preco: 100 }, { id })] });
    const depois = instantaneo({ campos: [], itens: [item('produtos', { preco: 120, nome: 'A' }, { id })] });
    const [mudanca] = diferencas(antes, depois);
    assert.equal(mudanca?.tipo, 'item');
    assert.deepEqual(mudanca?.tipo === 'item' ? mudanca.campos : null, [{ chave: 'preco', antes: 100, depois: 120 }]);
  });

  it('sem mudança, sem diferença', () => {
    const contexto = { campos: [entrada('modelo_de_negocio', ['b2b'])], itens: [item('produtos', { nome: 'A' })] };
    assert.deepEqual(diferencas(instantaneo(contexto), instantaneo(contexto)), []);
  });

  it('dados de item: chaves novas e removidas', () => {
    assert.deepEqual(diferencasDeDados({ a: 1 }, { b: 2 }), [
      { chave: 'a', antes: 1, depois: null },
      { chave: 'b', antes: null, depois: 2 },
    ]);
  });
});
