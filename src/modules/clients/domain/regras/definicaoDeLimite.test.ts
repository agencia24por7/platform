import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChaveSchema, DefinicaoDeLimiteSchema, validarLimiteContraDefinicao } from './definicaoDeLimite.ts';
import { definicao } from './fixturesDeTeste.ts';

describe('definição de limite', () => {
  it('aceita definição válida', () => {
    assert.ok(DefinicaoDeLimiteSchema.safeParse(definicao()).success);
  });
  it('recusa categoria que não é de limite, medida e unidade fora do vocabulário', () => {
    assert.ok(!DefinicaoDeLimiteSchema.safeParse({ ...definicao(), categoria: 'publico' }).success);
    assert.ok(!DefinicaoDeLimiteSchema.safeParse({ ...definicao(), medida: 'ctr' }).success);
    assert.ok(!DefinicaoDeLimiteSchema.safeParse({ ...definicao(), unidade: 'usd' }).success);
  });
  it('recusa chave mal formada, faixa invertida e escopo inválido ou repetido', () => {
    assert.ok(!DefinicaoDeLimiteSchema.safeParse(definicao({ key: 'SemPonto' })).success);
    assert.ok(!DefinicaoDeLimiteSchema.safeParse(definicao({ faixaMin: '10', faixaMax: '5' })).success);
    assert.ok(!DefinicaoDeLimiteSchema.safeParse(definicao({ escoposAceitos: ['conta:1'] })).success);
    assert.ok(!DefinicaoDeLimiteSchema.safeParse(definicao({ escoposAceitos: ['cliente', 'cliente'] })).success);
    assert.ok(!DefinicaoDeLimiteSchema.safeParse(definicao({ escoposAceitos: [] })).success);
  });
  it('a chave segue o mesmo limite do CHECK do banco: grupo até 40 e nome até 80', () => {
    const grupo = (n: number) => `g${'a'.repeat(n - 1)}`;
    assert.ok(ChaveSchema.safeParse(`${grupo(40)}.${grupo(80)}`).success);
    assert.ok(!ChaveSchema.safeParse(`${grupo(41)}.x`).success);
    assert.ok(!ChaveSchema.safeParse(`x.${grupo(81)}`).success);
    assert.ok(!ChaveSchema.safeParse(`${grupo(50)}.${grupo(20)}`).success);
    assert.ok(!ChaveSchema.safeParse('a.b.c').success);
    assert.ok(!ChaveSchema.safeParse('1a.b').success);
  });
  it('em centavos a faixa é inteira; em razão aceita decimal', () => {
    assert.ok(!DefinicaoDeLimiteSchema.safeParse(definicao({ faixaMax: '10.5' })).success);
    assert.ok(
      DefinicaoDeLimiteSchema.safeParse(
        definicao({ unidade: 'razao', medida: 'retorno', sentido: 'piso', faixaMin: '0.5', faixaMax: '20.5' }),
      ).success,
    );
  });
  it('valida o limite contra a definição: categoria, unidade, escopo e faixa', () => {
    const base = { categoria: 'investimento', escopo: 'cliente', valor: { unidade: 'brl_centavos', centavos: '500', moeda: 'BRL' } } as const;
    const def = definicao({ faixaMin: '100', faixaMax: '1000' });
    assert.ok(validarLimiteContraDefinicao(def, base).ok);
    const codigo = (resultado: ReturnType<typeof validarLimiteContraDefinicao>) => (resultado.ok ? null : resultado.error.codigo);
    assert.equal(codigo(validarLimiteContraDefinicao(def, { ...base, categoria: 'eficiencia' })), 'categoria_incompativel');
    assert.equal(codigo(validarLimiteContraDefinicao(def, { ...base, valor: { unidade: 'razao', decimal: '1' } })), 'unidade_incompativel');
    assert.equal(codigo(validarLimiteContraDefinicao(def, { ...base, escopo: 'plataforma:meta' })), 'escopo_nao_aceito');
    assert.equal(codigo(validarLimiteContraDefinicao(def, { ...base, valor: { unidade: 'brl_centavos', centavos: '99', moeda: 'BRL' } })), 'abaixo_da_faixa');
    assert.equal(codigo(validarLimiteContraDefinicao(def, { ...base, valor: { unidade: 'brl_centavos', centavos: '1001', moeda: 'BRL' } })), 'acima_da_faixa');
  });
});
