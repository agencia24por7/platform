import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HOJE, URN_BENCHMARK_B, URN_DESEMPENHO, URN_LIMITE, hashDeTeste, urnDeTeste } from './fixturesDeTeste.ts';
import { avaliarImpacto, type EntradaDeImpacto, type EntradaDoCatalogoAtual } from './impacto.ts';

function cenario(): EntradaDeImpacto {
  const catalogo = new Map<string, EntradaDoCatalogoAtual>([
    [URN_DESEMPENHO, { hash: hashDeTeste(1), tipo: 'tabela_de_dados' }],
    [URN_BENCHMARK_B, { hash: hashDeTeste(2), tipo: 'conhecimento', validoAte: '2027-06-30' }],
    [URN_LIMITE, { hash: hashDeTeste(6), tipo: 'limite' }],
  ]);
  return {
    referencias: [
      { urn: URN_DESEMPENHO, hash: hashDeTeste(1), papel: 'favor' },
      { urn: URN_BENCHMARK_B, hash: hashDeTeste(2), papel: 'premissa' },
    ],
    catalogoAtual: catalogo,
    lidasNaCriacao: new Map([...catalogo].map(([urn, e]) => [urn, e.hash])),
    tiposRelevantes: new Set(['conhecimento']),
    hoje: HOJE,
  };
}

describe('avaliarImpacto', () => {
  it('nenhum quando nada mudou', () => {
    assert.deepEqual(avaliarImpacto(cenario()), { impacto: 'nenhum', itens: [] });
  });

  it('material quando o hash de evidência ou premissa citada mudou', () => {
    const entrada = cenario();
    (entrada.catalogoAtual as Map<string, EntradaDoCatalogoAtual>).set(URN_BENCHMARK_B, { hash: hashDeTeste(99), tipo: 'conhecimento', validoAte: '2027-06-30' });
    const r = avaliarImpacto(entrada);
    assert.equal(r.impacto, 'material');
    assert.deepEqual(r.itens.map((i) => i.motivo), ['hash_mudou']);
  });

  it('material quando a entrada citada sumiu', () => {
    const entrada = cenario();
    (entrada.catalogoAtual as Map<string, EntradaDoCatalogoAtual>).delete(URN_DESEMPENHO);
    const r = avaliarImpacto(entrada);
    assert.equal(r.impacto, 'material');
    assert.equal(r.itens[0]?.motivo, 'entrada_removida');
  });

  it('material quando a evidência venceu (no dia seguinte ao validoAte)', () => {
    const entrada = { ...cenario(), hoje: '2027-07-01' };
    assert.equal(avaliarImpacto(entrada).itens[0]?.motivo, 'evidencia_vencida');
    assert.equal(avaliarImpacto({ ...cenario(), hoje: '2027-06-30' }).impacto, 'nenhum');
  });

  it('material quando limite ou regra mudou, citado ou não', () => {
    const entrada = cenario();
    (entrada.catalogoAtual as Map<string, EntradaDoCatalogoAtual>).set(URN_LIMITE, { hash: hashDeTeste(60), tipo: 'limite' });
    const r = avaliarImpacto(entrada);
    assert.equal(r.impacto, 'material');
    assert.equal(r.itens[0]?.motivo, 'limite_ou_regra_mudou');
  });

  it('material quando entra limite ou regra nova', () => {
    const entrada = cenario();
    (entrada.catalogoAtual as Map<string, EntradaDoCatalogoAtual>).set(urnDeTeste('regra', 'nova'), { hash: hashDeTeste(70), tipo: 'regra' });
    const r = avaliarImpacto(entrada);
    assert.equal(r.impacto, 'material');
    assert.equal(r.itens[0]?.motivo, 'limite_ou_regra_novo');
  });

  it('material quando entra decisão nova, e quando a regra citada some', () => {
    const entrada = cenario();
    (entrada.catalogoAtual as Map<string, EntradaDoCatalogoAtual>).set(urnDeTeste('decisao', 'nova'), { hash: hashDeTeste(71), tipo: 'decisao' });
    const r = avaliarImpacto(entrada);
    assert.equal(r.impacto, 'material');
    assert.equal(r.itens[0]?.motivo, 'limite_ou_regra_novo');
    const base = cenario();
    const removida = { ...base, referencias: [...base.referencias, { urn: URN_LIMITE, hash: hashDeTeste(6), papel: 'premissa' as const }] };
    (removida.catalogoAtual as Map<string, EntradaDoCatalogoAtual>).delete(URN_LIMITE);
    assert.equal(avaliarImpacto(removida).itens[0]?.motivo, 'entrada_removida');
  });

  it('informativo quando entra entrada nova de tipo relevante não citada', () => {
    const entrada = cenario();
    (entrada.catalogoAtual as Map<string, EntradaDoCatalogoAtual>).set(urnDeTeste('conhecimento', 'novo'), { hash: hashDeTeste(80), tipo: 'conhecimento' });
    (entrada.catalogoAtual as Map<string, EntradaDoCatalogoAtual>).set(urnDeTeste('arquivo', 'novo'), { hash: hashDeTeste(81), tipo: 'arquivo' });
    const r = avaliarImpacto(entrada);
    assert.equal(r.impacto, 'informativo');
    assert.equal(r.itens.length, 1);
    assert.equal(r.itens[0]?.motivo, 'entrada_nova_relevante');
  });

  it('é determinístico: material antes de informativo, depois por URN', () => {
    const entrada = cenario();
    const catalogo = entrada.catalogoAtual as Map<string, EntradaDoCatalogoAtual>;
    catalogo.set(urnDeTeste('conhecimento', 'novo'), { hash: hashDeTeste(80), tipo: 'conhecimento' });
    catalogo.delete(URN_DESEMPENHO);
    catalogo.set(URN_BENCHMARK_B, { hash: hashDeTeste(99), tipo: 'conhecimento' });
    const a = avaliarImpacto(entrada);
    const invertida = { ...entrada, referencias: [...entrada.referencias].reverse() };
    assert.deepEqual(avaliarImpacto(invertida), a);
    assert.deepEqual(a.itens.map((i) => i.impacto), ['material', 'material', 'informativo']);
  });
});
