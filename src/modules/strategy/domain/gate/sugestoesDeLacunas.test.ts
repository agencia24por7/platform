import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { URN_BENCHMARK_B, URN_BENCHMARK_D, contextoDeTeste, planoCompleto } from '../fixturesDeTeste.ts';
import { lerPlano, type Plano } from '../plano.ts';
import { checarSugestoesDeLacunas } from './sugestoesDeLacunas.ts';

const comLacuna = (extra: Record<string, unknown>): Plano => {
  const plano = planoCompleto();
  return {
    ...plano,
    lacunas: {
      itens: [
        ...plano.lacunas.itens,
        { id: 'lim_cpl', tipo: 'limite_ausente', medida: 'custo_por_lead', descricao: 'Sem teto de CPL.', impacto: 'Sem meta de eficiência.', regra: { natureza: 'limite', escopo: 'cliente' }, ...extra },
      ] as Plano['lacunas']['itens'],
    },
  };
};
const valor = { unidade: 'brl_centavos', centavos: '5000', moeda: 'BRL' };
const sugestao = (sobrescrita: Record<string, unknown>) => ({ valor, origem: 'evidencia', evidencias: [{ urn: URN_BENCHMARK_B, papel: 'favor' }], justificativa: 'Benchmark do setor.', ...sobrescrita });

describe('lacunas: esquema e gate das sugestões', () => {
  it('aceita lacuna com regra e sugestão com origem em evidência', () => {
    const lido = lerPlano(comLacuna({ sugestao: sugestao({}) }));
    assert.equal(lido.ok, true);
  });

  it('recusa valor sem origem em evidência: hipótese não traz valor', () => {
    assert.equal(lerPlano(comLacuna({ sugestao: sugestao({ origem: 'hipotese', evidencias: [] }) })).ok, false);
    assert.equal(lerPlano(comLacuna({ sugestao: sugestao({ evidencias: [] }) })).ok, false);
    assert.equal(lerPlano(comLacuna({ sugestao: sugestao({ evidencias: [{ urn: URN_BENCHMARK_B, papel: 'contra' }] }) })).ok, false);
  });

  it('hipótese sem valor é a forma de "sem sugestão"', () => {
    assert.equal(lerPlano(comLacuna({ sugestao: { valor: null, origem: 'hipotese', evidencias: [], justificativa: 'Sem dado no Brain.' } })).ok, true);
  });

  it('sugestão exige a regra estruturada e a natureza combina com o tipo de valor', () => {
    const semRegra = comLacuna({ regra: undefined, sugestao: sugestao({}) });
    assert.equal(lerPlano(semRegra).ok, false);
    assert.equal(lerPlano(comLacuna({ sugestao: sugestao({ valor: { texto: 'x' } }) })).ok, false);
    assert.equal(lerPlano(comLacuna({ regra: { natureza: 'regra', categoria: 'etica_marca', escopo: 'cliente' }, sugestao: sugestao({}) })).ok, false);
    assert.equal(lerPlano(comLacuna({ tipo: 'regra_ausente', medida: undefined, regra: { natureza: 'regra', categoria: 'etica_marca', chave: 'marca.tom', escopo: 'cliente' }, sugestao: sugestao({ valor: { texto: 'Tom sóbrio.' } }) })).ok, true);
  });

  it('gate aprova valor com evidência nota B e reprova só nota D', () => {
    const boa = lerPlano(comLacuna({ sugestao: sugestao({}) }));
    assert.ok(boa.ok);
    assert.equal(checarSugestoesDeLacunas(contextoDeTeste({ plano: boa.ok ? boa.value : planoCompleto() })).resultado, 'aprovado');
    const ruim = lerPlano(comLacuna({ sugestao: sugestao({ evidencias: [{ urn: URN_BENCHMARK_D, papel: 'favor' }] }) }));
    assert.ok(ruim.ok);
    const r = checarSugestoesDeLacunas(contextoDeTeste({ plano: ruim.ok ? ruim.value : planoCompleto() }));
    assert.equal(r.resultado, 'reprovado');
    assert.deepEqual(r.onde, ['lacunas/lim_cpl (valor sugerido só com nota D)']);
  });

  it('gate reprova valor cuja evidência não está no pacote', () => {
    const fora = lerPlano(comLacuna({ sugestao: sugestao({ evidencias: [{ urn: URN_BENCHMARK_B.replace('benchmark-b', 'inexistente'), papel: 'favor' }] }) }));
    assert.ok(fora.ok);
    const r = checarSugestoesDeLacunas(contextoDeTeste({ plano: fora.ok ? fora.value : planoCompleto() }));
    assert.equal(r.resultado, 'reprovado');
    assert.match(r.onde[0] ?? '', /sem origem no pacote/);
  });

  it('plano sem sugestão com valor aprova', () => {
    assert.equal(checarSugestoesDeLacunas(contextoDeTeste()).resultado, 'aprovado');
  });
});
