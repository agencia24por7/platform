import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { valorDaEdicao } from './edicaoDeSugestao.ts';

const dinheiro = { unidade: 'brl_centavos', centavos: '100000', moeda: 'BRL' } as const;

describe('edição de sugestão de lacuna', () => {
  it('texto igual ao original ou vazio não envia valor', () => {
    assert.deepEqual(valorDaEdicao(dinheiro, 'R$ 1.000,00', 'R$ 1.000,00'), { valor: null });
    assert.deepEqual(valorDaEdicao(dinheiro, '  ', 'R$ 1.000,00'), { valor: null });
  });
  it('dinheiro vira centavos e texto livre vira texto', () => {
    assert.deepEqual(valorDaEdicao(dinheiro, 'R$ 2.500,50', 'R$ 1.000,00'), { valor: { unidade: 'brl_centavos', centavos: '250050', moeda: 'BRL' } });
    assert.deepEqual(valorDaEdicao({ texto: 'a' }, ' Sem promessa ', 'a'), { valor: { texto: 'Sem promessa' } });
  });
  it('percentual troca vírgula por ponto e deixa o servidor validar o resto', () => {
    assert.deepEqual(valorDaEdicao({ unidade: 'percentual', decimal: '10' }, '12,5%', '10%'), { valor: { unidade: 'percentual', decimal: '12.5' } });
    assert.deepEqual(valorDaEdicao(dinheiro, 'abc', 'R$ 1.000,00'), { valor: { unidade: 'brl_centavos', centavos: 'abc', moeda: 'BRL' } });
  });
});
