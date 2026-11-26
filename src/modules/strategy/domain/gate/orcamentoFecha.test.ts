import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextoDeTeste } from '../fixturesDeTeste.ts';
import { checarOrcamentoFecha } from './orcamentoFecha.ts';

const BRL = (centavos: string) => ({ centavos, moeda: 'BRL' as const });

describe('gate: orcamento_fecha', () => {
  it('aprova quando a soma das campanhas é o total', () => {
    assert.equal(checarOrcamentoFecha(contextoDeTeste()).resultado, 'aprovado');
  });

  it('reprova soma de campanhas diferente do total', () => {
    const contexto = contextoDeTeste();
    contexto.plano.campanhas.campanhas[0]!.verba = BRL('600001');
    const r = checarOrcamentoFecha(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde[0]?.startsWith('campanhas'));
  });

  it('reprova total acima da verba da intenção', () => {
    const contexto = contextoDeTeste();
    contexto.plano.intencao.verba = BRL('999999');
    const r = checarOrcamentoFecha(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.some((o) => o.includes('acima da verba da intenção')));
  });

  it('total abaixo da verba da intenção é permitido', () => {
    const contexto = contextoDeTeste();
    contexto.plano.intencao.verba = BRL('2000000');
    assert.equal(checarOrcamentoFecha(contexto).resultado, 'aprovado');
  });

  it('reprova divisão por canal que não fecha, verba de teste acima do total e resumo divergente', () => {
    const contexto = contextoDeTeste();
    contexto.plano.orcamento.por_canal[0]!.valor = BRL('1');
    contexto.plano.orcamento.verba_de_teste = BRL('2000000');
    contexto.plano.resumo_executivo.verba = BRL('5');
    const r = checarOrcamentoFecha(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.equal(r.onde.length, 3);
  });

  it('soma exata com valores grandes (sem ponto flutuante)', () => {
    const contexto = contextoDeTeste();
    contexto.plano.orcamento.total = BRL('900719925474099300');
    contexto.plano.intencao.verba = BRL('900719925474099300');
    contexto.plano.resumo_executivo.verba = BRL('900719925474099300');
    contexto.plano.campanhas.campanhas[0]!.verba = BRL('900719925474099299');
    contexto.plano.campanhas.campanhas[1]!.verba = BRL('1');
    contexto.plano.orcamento.por_canal = [];
    contexto.plano.orcamento.verba_de_teste = BRL('0');
    assert.equal(checarOrcamentoFecha(contexto).resultado, 'aprovado');
  });
});
