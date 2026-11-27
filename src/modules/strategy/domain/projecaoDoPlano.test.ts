import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planoCompleto } from './fixturesDeTeste.ts';
import { planoParaOGateDeModelo, secoesDoPlano, semCampo } from './projecaoDoPlano.ts';

describe('projeção do plano para o Comitê e o Gate por modelo', () => {
  it('secoesDoPlano mantém intenção e as seções pedidas; sem lista devolve o plano', () => {
    const plano = planoCompleto();
    assert.deepEqual(Object.keys(secoesDoPlano(plano, ['campanhas'])).sort(), ['campanhas', 'intencao', 'schema_version']);
    assert.equal(secoesDoPlano(plano, undefined), plano);
  });

  it('o gate por modelo não recebe evidências, resumo nem orçamento, mas recebe o plano de mídia', () => {
    const projetado = planoParaOGateDeModelo(planoCompleto()) as Record<string, unknown>;
    assert.ok(projetado['plano_de_midia'] && projetado['campanhas']);
    assert.equal(projetado['resumo_executivo'], undefined);
    assert.equal(projetado['orcamento'], undefined);
    assert.ok(!JSON.stringify(projetado).includes('"evidencias"'));
    assert.ok(JSON.stringify(planoCompleto()).length > JSON.stringify(projetado).length);
  });

  it('semCampo remove a chave em qualquer profundidade sem alterar a origem', () => {
    const origem = { a: [{ evidencias: 1, b: 2 }], evidencias: 3 };
    assert.deepEqual(semCampo(origem, 'evidencias'), { a: [{ b: 2 }] });
    assert.equal(origem.evidencias, 3);
  });
});
