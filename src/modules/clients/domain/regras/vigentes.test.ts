import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AGORA, AMANHA, decisao, ONTEM, regra } from './fixturesDeTeste.ts';
import { chaveDoIndice, derivarVigentes, estaVigente, hashDoConjunto } from './vigentes.ts';

describe('vigentes', () => {
  it('vigência futura não vale ainda', () => {
    const futura = decisao({ vigenciaInicio: AMANHA });
    assert.ok(!estaVigente(futura, AGORA));
    assert.equal(derivarVigentes([futura], AGORA).decisoes.length, 0);
    assert.ok(estaVigente(futura, new Date(AMANHA)));
  });
  it('vigência vencida não vale mais (o fim é exclusivo)', () => {
    const vencida = decisao({ vigenciaInicio: new Date('2026-11-01T00:00:00Z'), vigenciaFim: ONTEM });
    assert.ok(!estaVigente(vencida, AGORA));
    assert.equal(derivarVigentes([vencida], AGORA).decisoes.length, 0);
    assert.ok(!estaVigente(vencida, ONTEM));
    assert.ok(estaVigente(decisao({ vigenciaFim: AMANHA }), AGORA));
  });
  it('proposta de agente não entra em vigentes; vigente de agente (decisão de processo) entra', () => {
    const proposta = decisao({ origem: 'agente', agentId: 'a', agentRunId: 'r', status: 'proposta' });
    const registro = regra({ origem: 'agente', agentId: 'a', agentRunId: 'r', status: 'vigente', categoria: 'processo', natureza: 'decisao', chave: null });
    const conjunto = derivarVigentes([proposta, registro], AGORA);
    assert.deepEqual(conjunto.decisoes.map((d) => d.id), [registro.id]);
  });
  it('status superada, revogada e rejeitada ficam de fora', () => {
    const lista = [
      decisao({ status: 'superada' }),
      decisao({ status: 'revogada', motivoDaRevogacao: 'x' }),
      decisao({ status: 'rejeitada' }),
    ];
    assert.equal(derivarVigentes(lista, AGORA).decisoes.length, 0);
  });
  it('dois limites na mesma chave: escopos diferentes convivem, indexados separadamente', () => {
    const geral = decisao({ escopo: 'cliente' });
    const google = decisao({ escopo: 'plataforma:google_ads' });
    const conjunto = derivarVigentes([geral, google], AGORA);
    assert.equal(conjunto.decisoes.length, 2);
    assert.equal(conjunto.porChaveEEscopo.size, 2);
    assert.equal(conjunto.porChaveEEscopo.get(chaveDoIndice(google))?.id, google.id);
    assert.equal(conjunto.conflitos.length, 0);
  });
  it('dois limites na mesma chave e escopo: vale o de maior número e o outro vira conflito', () => {
    const antigo = decisao({ numero: 1 });
    const novo = decisao({ numero: 2 });
    const conjunto = derivarVigentes([novo, antigo], AGORA);
    assert.deepEqual(conjunto.decisoes.map((d) => d.id), [novo.id]);
    assert.deepEqual(conjunto.conflitos.map((d) => d.id), [antigo.id]);
  });
  it('hash do conjunto é estável e independe da ordem', () => {
    const a = decisao();
    const b = regra();
    const c = decisao({ escopo: 'plataforma:meta' });
    const h1 = hashDoConjunto([a, b, c]);
    assert.match(h1, /^[0-9a-f]{64}$/);
    assert.equal(hashDoConjunto([c, a, b]), h1);
    assert.equal(hashDoConjunto([a, b, c].map((d) => ({ ...d }))), h1);
    assert.notEqual(hashDoConjunto([a, b]), h1);
    assert.notEqual(hashDoConjunto([{ ...a, valor: { unidade: 'brl_centavos', centavos: '1', moeda: 'BRL' } }, b, c]), h1);
  });
});
