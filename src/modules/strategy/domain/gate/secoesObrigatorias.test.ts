import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextoDeTeste, planoMinimo } from '../fixturesDeTeste.ts';
import { SECOES_OBRIGATORIAS, checarSecoesObrigatorias } from './secoesObrigatorias.ts';

describe('gate: secoes_obrigatorias', () => {
  it('aprova o plano completo e o mínimo', () => {
    assert.equal(checarSecoesObrigatorias(contextoDeTeste()).resultado, 'aprovado');
    assert.equal(checarSecoesObrigatorias(contextoDeTeste({ plano: planoMinimo() })).resultado, 'aprovado');
  });

  it('comunidades e lacunas podem ficar vazias', () => {
    const nomes = SECOES_OBRIGATORIAS.map((s) => s.secao);
    assert.equal(nomes.includes('comunidades_alvo'), false);
    assert.equal(nomes.includes('lacunas'), false);
  });

  it('reprova seção obrigatória vazia e lista quais', () => {
    const contexto = contextoDeTeste();
    contexto.plano.campanhas.campanhas = [];
    contexto.plano.calendario.fases = [];
    contexto.plano.metas_e_metricas.metas = contexto.plano.metas_e_metricas.metas.filter((m) => m.nivel === 'canal');
    contexto.plano.plano_de_midia = { plataformas: [] };
    const r = checarSecoesObrigatorias(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.deepEqual(r.onde, ['calendario', 'campanhas', 'metas_e_metricas', 'plano_de_midia']);
  });
});
