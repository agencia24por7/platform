import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { URN_BENCHMARK_B, URN_DESEMPENHO } from '../fixturesDeTeste.ts';
import { consolidarPareceres } from './consolidacao.ts';
import { parecer, ponto } from './fixturesDeParecer.ts';

describe('consolidarPareceres', () => {
  it('eco não é evidência: mesma fonte no mesmo trecho vira um argumento', () => {
    const r = consolidarPareceres([
      parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'campanhas/cp_busca', [URN_BENCHMARK_B, URN_DESEMPENHO])]),
      parecer('marqueteiro', 'aprova_com_ajuste', [ponto('p9', 'campanhas/cp_busca', [URN_DESEMPENHO, URN_BENCHMARK_B])]),
    ]);
    assert.equal(r.totalDePontos, 2);
    assert.equal(r.totalDeArgumentos, 1);
    assert.deepEqual(r.argumentos[0]?.personas, ['marqueteiro', 'redator']);
    assert.equal(r.argumentos[0]?.pontos.length, 2);
  });

  it('fontes diferentes ou trechos diferentes são argumentos distintos', () => {
    const r = consolidarPareceres([
      parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'campanhas/cp_busca', [URN_BENCHMARK_B])]),
      parecer('marqueteiro', 'aprova_com_ajuste', [ponto('p1', 'campanhas/cp_busca', [URN_DESEMPENHO])]),
      parecer('sdr', 'aprova_com_ajuste', [ponto('p1', 'criativos', [URN_BENCHMARK_B])]),
    ]);
    assert.equal(r.totalDeArgumentos, 3);
  });

  it('pontos sem fonte nunca se fundem', () => {
    const r = consolidarPareceres([
      parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'campanhas')]),
      parecer('marqueteiro', 'aprova_com_ajuste', [ponto('p1', 'campanhas')]),
    ]);
    assert.equal(r.totalDeArgumentos, 2);
  });

  it('lista como pendência obrigatória só a reprovação de persona que obriga ajuste', () => {
    const r = consolidarPareceres([
      parecer('risco_legal', 'reprova', [ponto('p1', 'riscos_e_regras'), ponto('p2', 'campanhas')]),
      parecer('redator', 'reprova', [ponto('p1', 'campanhas')]),
      parecer('risco_legal', 'aprova_com_ajuste', [ponto('p3', 'criativos')]),
    ]);
    assert.deepEqual(r.pendenciasObrigatorias, [
      { persona: 'risco_legal', pontoId: 'p1', trecho: 'riscos_e_regras' },
      { persona: 'risco_legal', pontoId: 'p2', trecho: 'campanhas' },
    ]);
  });

  it('conta vereditos e é determinístico na ordem dos argumentos', () => {
    const a = parecer('redator', 'aprova');
    const b = parecer('sdr', 'aprova_com_ajuste', [ponto('p1', 'criativos')]);
    const c = parecer('publicitario', 'aprova_com_ajuste', [ponto('p1', 'campanhas')]);
    const r1 = consolidarPareceres([a, b, c]);
    const r2 = consolidarPareceres([c, b, a]);
    assert.deepEqual(r1.argumentos, r2.argumentos);
    assert.deepEqual(r1.vereditos, { aprova: 1, aprova_com_ajuste: 2, reprova: 0 });
    assert.equal(consolidarPareceres([]).totalDeArgumentos, 0);
  });
});
