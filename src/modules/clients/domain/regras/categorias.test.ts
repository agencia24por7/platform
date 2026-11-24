import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATEGORIAS, ehCategoria, ehCategoriaDeLimite } from './categoria.ts';
import { ehNatureza, ehNormativa } from './natureza.ts';
import { ehOrigem } from './origem.ts';
import { ehForca } from './forca.ts';
import { ehStatus, ehTerminal } from './status.ts';
import { ehMedida, MEDIDAS } from './medida.ts';

describe('vocabulários fechados', () => {
  it('categorias: sete, e só investimento e eficiencia aceitam limite', () => {
    assert.equal(CATEGORIAS.length, 7);
    assert.deepEqual(CATEGORIAS.filter(ehCategoriaDeLimite), ['investimento', 'eficiencia']);
    assert.ok(ehCategoria('processo'));
    assert.ok(!ehCategoria('outra'));
  });
  it('natureza, origem, força e status rejeitam texto solto', () => {
    assert.ok(ehNatureza('limite') && !ehNatureza('meta'));
    assert.ok(ehNormativa('regra') && !ehNormativa('decisao'));
    assert.ok(ehOrigem('agente') && !ehOrigem('robo'));
    assert.ok(ehForca('dura') && !ehForca('media'));
    assert.ok(ehStatus('vigente') && !ehStatus('ativa'));
    assert.ok(ehTerminal('revogada') && !ehTerminal('proposta'));
  });
  it('medidas: o vocabulário que o sistema sabe calcular', () => {
    assert.deepEqual([...MEDIDAS], ['gasto', 'custo_por_aquisicao', 'custo_por_lead', 'retorno']);
    assert.ok(ehMedida('retorno') && !ehMedida('ctr'));
  });
});
