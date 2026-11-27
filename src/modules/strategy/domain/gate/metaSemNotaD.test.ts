import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { URN_BENCHMARK_B, URN_BENCHMARK_D, URN_DESEMPENHO, contextoDeTeste, evidencia } from '../fixturesDeTeste.ts';
import { checarMetaSemNotaD } from './metaSemNotaD.ts';

describe('gate: meta_sem_nota_d', () => {
  it('aprova o plano de teste e lista metas só de hipótese', () => {
    const r = checarMetaSemNotaD(contextoDeTeste());
    assert.equal(r.resultado, 'aprovado');
    assert.ok(r.onde.some((o) => o.includes('m_canal')));
  });

  it('reprova meta sustentada só por nota D', () => {
    const contexto = contextoDeTeste();
    const meta = contexto.plano.metas_e_metricas.metas[0]!;
    meta.evidencias = [evidencia(URN_BENCHMARK_D)];
    delete meta.nota_da_evidencia;
    const r = checarMetaSemNotaD(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.deepEqual(r.onde, ['metas_e_metricas/m_neg (só nota D)']);
  });

  it('meta marcada como hipótese também não pode ser sustentada só por D', () => {
    const contexto = contextoDeTeste();
    const meta = contexto.plano.metas_e_metricas.metas[0]!;
    meta.evidencias = [evidencia(URN_BENCHMARK_D)];
    meta.hipotese = true;
    assert.equal(checarMetaSemNotaD(contexto).resultado, 'reprovado');
  });

  it('D junto de nota melhor ou de dado sem nota não reprova', () => {
    const contexto = contextoDeTeste();
    const meta = contexto.plano.metas_e_metricas.metas[0]!;
    meta.evidencias = [evidencia(URN_BENCHMARK_D), evidencia(URN_BENCHMARK_B, 'premissa')];
    assert.equal(checarMetaSemNotaD(contexto).resultado, 'aprovado');
    meta.evidencias = [evidencia(URN_BENCHMARK_D), evidencia(URN_DESEMPENHO)];
    delete meta.nota_da_evidencia;
    assert.equal(checarMetaSemNotaD(contexto).resultado, 'aprovado');
  });

  it('evidência só contra não sustenta meta que não é hipótese', () => {
    const contexto = contextoDeTeste();
    contexto.plano.metas_e_metricas.metas[0]!.evidencias = [evidencia(URN_BENCHMARK_B, 'contra')];
    assert.equal(checarMetaSemNotaD(contexto).resultado, 'reprovado');
  });

  it('reprova nota declarada acima da real', () => {
    const contexto = contextoDeTeste();
    contexto.plano.metas_e_metricas.metas[0]!.nota_da_evidencia = 'A';
    const r = checarMetaSemNotaD(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde[0]?.includes('acima da real B'));
  });
});
