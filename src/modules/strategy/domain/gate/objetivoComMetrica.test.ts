import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextoDeTeste } from '../fixturesDeTeste.ts';
import { checarObjetivoComMetrica } from './objetivoComMetrica.ts';

describe('gate: objetivo_com_metrica', () => {
  it('aprova quando toda meta e campanha tem métrica e forma de medir', () => {
    assert.equal(checarObjetivoComMetrica(contextoDeTeste()).resultado, 'aprovado');
  });

  it('reprova meta sem item de medição', () => {
    const contexto = contextoDeTeste();
    contexto.plano.medicao.itens = contexto.plano.medicao.itens.filter((i) => i.meta_id !== 'm_social');
    const r = checarObjetivoComMetrica(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.includes('metas_e_metricas/m_social (sem forma de medir)'));
    assert.ok(r.onde.includes('campanhas/cp_social (meta sem forma de medir)'));
  });

  it('reprova medição em branco e métrica pareada vazia', () => {
    const contexto = contextoDeTeste();
    contexto.plano.medicao.itens[0]!.como_medir = '  ';
    contexto.plano.metas_e_metricas.metas[1]!.metrica_de_qualidade = ' ';
    const r = checarObjetivoComMetrica(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.includes('metas_e_metricas/m_neg (sem forma de medir)'));
    assert.ok(r.onde.includes('metas_e_metricas/m_canal (sem métrica pareada de custo e qualidade)'));
  });

  it('reprova campanha sem métrica de sucesso', () => {
    const contexto = contextoDeTeste();
    contexto.plano.campanhas.campanhas[0]!.metrica_de_sucesso = '';
    assert.equal(checarObjetivoComMetrica(contexto).resultado, 'reprovado');
  });
});
