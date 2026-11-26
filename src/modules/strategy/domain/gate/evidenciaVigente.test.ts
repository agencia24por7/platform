import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { URN_BENCHMARK_B, URN_BENCHMARK_VENCIDO, afirmacao, contextoDeTeste, evidencia } from '../fixturesDeTeste.ts';
import { checarEvidenciaVigente } from './evidenciaVigente.ts';

describe('gate: evidencia_vigente', () => {
  it('aprova quando nenhuma evidência venceu', () => {
    assert.equal(checarEvidenciaVigente(contextoDeTeste()).resultado, 'aprovado');
  });

  it('reprova evidência vencida', () => {
    const contexto = contextoDeTeste();
    contexto.plano.resumo_executivo.resultado_esperado = afirmacao('x', evidencia(URN_BENCHMARK_VENCIDO));
    const r = checarEvidenciaVigente(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde[0]?.startsWith('resumo_executivo'));
  });

  it('o dia do validoAte ainda vale; o seguinte não', () => {
    assert.equal(checarEvidenciaVigente(contextoDeTeste({ hoje: '2027-06-30' })).resultado, 'aprovado');
    const r = checarEvidenciaVigente(contextoDeTeste({ hoje: '2027-07-01' }));
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.some((o) => o.includes(URN_BENCHMARK_B)));
  });
});
