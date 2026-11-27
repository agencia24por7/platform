import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planoCompleto } from './fixturesDeTeste.ts';
import { fixarIntencao, intencoesIguais } from './fixarIntencao.ts';

describe('fixarIntencao', () => {
  it('intenção igual (qualquer ordem de chaves) não é alterada', () => {
    const original = planoCompleto().intencao;
    const embaralhada = JSON.parse(JSON.stringify({ verba: original.verba, objetivo: original.objetivo, horizonte: original.horizonte, retorno_esperado: original.retorno_esperado, ousadia: original.ousadia, utm: original.utm, destino: original.destino, whatsapp: original.whatsapp, plataformas: original.plataformas }));
    assert.equal(intencoesIguais(original, embaralhada), true);
    const plano = planoCompleto();
    const r = fixarIntencao(plano, embaralhada);
    assert.equal(r.alterada, false);
    assert.equal(r.plano, plano);
  });

  it('verba, horizonte, ousadia, objetivo e retorno diferentes são substituídos pelos confiáveis', () => {
    const confiavel = planoCompleto().intencao;
    const mexidas = [
      (p: ReturnType<typeof planoCompleto>) => { p.intencao.verba = { centavos: '9', moeda: 'BRL' }; },
      (p: ReturnType<typeof planoCompleto>) => { p.intencao.horizonte = { inicio: '2026-12-01', fim: '2031-01-01' }; },
      (p: ReturnType<typeof planoCompleto>) => { p.intencao.ousadia = 'ousado'; },
      (p: ReturnType<typeof planoCompleto>) => { p.intencao.objetivo = 'Outro objetivo'; },
      (p: ReturnType<typeof planoCompleto>) => { p.intencao.plataformas = ['tiktok']; },
      (p: ReturnType<typeof planoCompleto>) => { p.intencao.whatsapp = '+5511000000000'; },
      (p: ReturnType<typeof planoCompleto>) => { p.intencao.destino = { landingPageId: 'lp_outra', url: 'https://outro.com' }; },
      (p: ReturnType<typeof planoCompleto>) => { p.intencao.utm = {}; },
      (p: ReturnType<typeof planoCompleto>) => { p.intencao.retorno_esperado = { descricao: 'x', valor: { unidade: 'contagem', quantidade: 1 } }; },
    ];
    for (const mexer of mexidas) {
      const plano = planoCompleto();
      mexer(plano);
      const r = fixarIntencao(plano, confiavel);
      assert.equal(r.alterada, true);
      assert.deepEqual(r.plano.intencao, confiavel);
      assert.deepEqual({ ...r.plano, intencao: 0 }, { ...plano, intencao: 0 });
    }
  });
});
