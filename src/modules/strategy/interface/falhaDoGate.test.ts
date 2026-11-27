import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROTULO_DA_CHECAGEM } from './rotulosDoPlano.ts';
import { falhaDoGate, itemLegivel, type EstadoParaFalhaDoGate } from './falhaDoGate.ts';

const reprovado = {
  resultado: 'reprovado',
  checagens: [
    { chave: 'urns_no_pacote', resultado: 'aprovado', motivo: 'ok', onde: [] },
    {
      chave: 'nao_faremos_preservado',
      resultado: 'reprovado',
      motivo: '4 perdidos',
      onde: ['estrategia/nf1 (removido em relação à versão base)', 'estrategia/nf2 (removido em relação à versão base)'],
    },
  ],
  modelo: null,
};
const estado = (sobrescrita: Partial<EstadoParaFalhaDoGate> = {}): EstadoParaFalhaDoGate => ({
  status: 'rascunho',
  resultadoDoGate: reprovado,
  execucaoAtiva: false,
  ultimaExecucao: { tipo: 'criar', status: 'falhou', erroCodigo: 'gate_reprovado' },
  correcoesFeitas: 0,
  papel: 'operator',
  ...sobrescrita,
});

describe('falha do gate para a tela', () => {
  it('nenhum texto visível cita Comitê, Gate, Brain nem nome interno de checagem', () => {
    const chaves = [...Object.keys(ROTULO_DA_CHECAGEM), 'cobertura_do_plano_de_midia', 'sugestoes_de_lacunas'];
    const checagens = chaves.map((chave) => ({ chave, resultado: 'reprovado', motivo: 'm', onde: [] as string[] }));
    const falha = falhaDoGate(estado({ resultadoDoGate: { resultado: 'reprovado', checagens, modelo: null } }));
    assert.equal(falha?.falhas.length, chaves.length);
    for (const item of falha?.falhas ?? []) assert.doesNotMatch(item.gate, /Comitê|Gate|Brain|_/i, item.gate);
    assert.doesNotMatch(falha?.motivoLegivel ?? '', /Comitê|Gate|Brain|_/i);
  });

  it('devolve o gate e os itens em português, sem jargão interno, e permite corrigir', () => {
    const falha = falhaDoGate(estado());
    assert.equal(falha?.possivel, true);
    assert.deepEqual(falha?.falhas, [
      { gate: 'O que "não faremos" da versão base foi mantido', itens: ['Estratégia · nf1: removido em relação à versão base', 'Estratégia · nf2: removido em relação à versão base'] },
    ]);
    assert.match(falha?.motivoLegivel ?? '', /não passou na conferência/);
    assert.doesNotMatch(JSON.stringify(falha), /gate_reprovado|nao_faremos_preservado|Comitê/i);
  });

  it('não há falha quando o gate aprovou, não há gate ou a versão não é rascunho', () => {
    assert.equal(falhaDoGate(estado({ resultadoDoGate: { resultado: 'aprovado', checagens: [] } })), null);
    assert.equal(falhaDoGate(estado({ resultadoDoGate: null })), null);
    assert.equal(falhaDoGate(estado({ status: 'proposto' })), null);
    assert.equal(falhaDoGate(estado({ status: null })), null);
  });

  it('não é possível com execução ativa, sem papel ou depois de duas correções, e diz por quê', () => {
    assert.equal(falhaDoGate(estado({ execucaoAtiva: true }))?.possivel, false);
    assert.match(falhaDoGate(estado({ execucaoAtiva: true }))?.motivoLegivel ?? '', /em andamento/);
    assert.equal(falhaDoGate(estado({ papel: 'viewer' }))?.possivel, false);
    const limite = falhaDoGate(estado({ correcoesFeitas: 2 }));
    assert.equal(limite?.possivel, false);
    assert.match(limite?.motivoLegivel ?? '', /limite de 2 correções/);
  });

  it('depois de uma correção que não convergiu explica qual conferência e quais itens, e deixa tentar de novo', () => {
    const falha = falhaDoGate(estado({ correcoesFeitas: 1, ultimaExecucao: { tipo: 'corrigir_gate', status: 'falhou', erroCodigo: 'correcao_nao_convergiu' } }));
    assert.equal(falha?.possivel, true);
    assert.match(falha?.motivoLegivel ?? '', /A correção automática não resolveu: O que "não faremos" da versão base foi mantido/);
  });

  it('junta o que o modelo apontou como conferência de qualidade', () => {
    const falha = falhaDoGate(estado({ resultadoDoGate: { resultado: 'reprovado', checagens: [], modelo: { problemas: [{ trecho: 'campanhas', problema: 'Meta incoerente.' }] } } }));
    assert.deepEqual(falha?.falhas, [{ gate: 'Coerência e plausibilidade do plano', itens: ['Campanhas: Meta incoerente.'] }]);
  });

  it('itemLegivel traduz seção e id', () => {
    assert.equal(itemLegivel('metas_e_metricas/meta_cpl (só nota D)'), 'Metas e métricas · meta cpl: só nota D');
    assert.equal(itemLegivel('orcamento'), 'Orçamento');
  });
});
