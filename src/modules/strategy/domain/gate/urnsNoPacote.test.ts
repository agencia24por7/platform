import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { URN_RESTRITA, afirmacao, contextoDeTeste, evidencia, urnDeTeste } from '../fixturesDeTeste.ts';
import { CHAVE_URNS_NO_PACOTE, checarUrnsNoPacote } from './urnsNoPacote.ts';

describe('gate: urns_no_pacote', () => {
  it('aprova quando toda citação está no pacote', () => {
    const r = checarUrnsNoPacote(contextoDeTeste());
    assert.equal(r.chave, CHAVE_URNS_NO_PACOTE);
    assert.equal(r.resultado, 'aprovado');
  });

  it('reprova citação fora do pacote e diz onde', () => {
    const contexto = contextoDeTeste();
    const fora = urnDeTeste('conhecimento', 'inventada');
    contexto.plano.diagnostico.situacao = afirmacao('x', evidencia(fora));
    const r = checarUrnsNoPacote(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.deepEqual(r.onde, [`diagnostico (${fora})`]);
  });

  it('reprova número apoiado só em entrada de metadados', () => {
    const contexto = contextoDeTeste();
    contexto.plano.metas_e_metricas.metas[0]!.evidencias.push(evidencia(URN_RESTRITA));
    const r = checarUrnsNoPacote(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde[0]?.startsWith('metas_e_metricas/m_neg'));
  });

  it('metadados fora de seção com número não reprovam', () => {
    const contexto = contextoDeTeste();
    contexto.plano.riscos_e_regras.riscos[0]!.evidencias.push(evidencia(URN_RESTRITA));
    assert.equal(checarUrnsNoPacote(contexto).resultado, 'aprovado');
  });
});
