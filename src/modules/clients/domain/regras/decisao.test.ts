import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DecisaoSchema, LIMITES_DE_TAMANHO } from './decisao.ts';
import { AGORA, AMANHA, decisao, regra } from './fixturesDeTeste.ts';

const valida = (entrada: unknown) => DecisaoSchema.safeParse(entrada).success;

describe('decisão', () => {
  it('aceita limite e regra coerentes', () => {
    assert.ok(valida(decisao()));
    assert.ok(valida(regra()));
  });
  it('limite exige chave, valor, definição e categoria de limite', () => {
    assert.ok(!valida(decisao({ chave: null })));
    assert.ok(!valida(decisao({ valor: null })));
    assert.ok(!valida(decisao({ definicaoChave: null, definicaoVersao: null })));
    assert.ok(!valida(decisao({ definicaoChave: 'eficiencia.cac_maximo' })));
    assert.ok(!valida(decisao({ categoria: 'publico' })));
  });
  it('regra exige chave e texto; só limite carrega valor', () => {
    assert.ok(!valida(regra({ chave: null })));
    assert.ok(!valida(regra({ texto: null })));
    assert.ok(!valida(regra({ valor: { unidade: 'razao', decimal: '1' } })));
  });
  it('origem agente exige agentId e agentRunId', () => {
    assert.ok(!valida(decisao({ origem: 'agente', agentId: 'a1', agentRunId: null })));
    assert.ok(!valida(decisao({ origem: 'agente', agentId: null, agentRunId: 'r1' })));
    assert.ok(valida(decisao({ origem: 'agente', agentId: 'a1', agentRunId: 'r1' })));
  });
  it('revogada exige motivo', () => {
    assert.ok(!valida(decisao({ status: 'revogada' })));
    assert.ok(valida(decisao({ status: 'revogada', motivoDaRevogacao: 'cliente pediu' })));
  });
  it('respeita tamanhos máximos e chave no formato', () => {
    assert.ok(valida(decisao({ titulo: 'a'.repeat(LIMITES_DE_TAMANHO.titulo) })));
    assert.ok(!valida(decisao({ titulo: 'a'.repeat(121) })));
    assert.ok(!valida(decisao({ contexto: 'a'.repeat(2001) })));
    assert.ok(!valida(regra({ texto: 'a'.repeat(4001) })));
    assert.ok(!valida(decisao({ evidencia: 'a'.repeat(501) })));
    assert.ok(!valida(regra({ chave: 'Sem.Formato' })));
    assert.ok(!valida(regra({ chave: 'semponto' })));
  });
  it('fim da vigência deve ser posterior ao início', () => {
    assert.ok(valida(decisao({ vigenciaFim: AMANHA })));
    assert.ok(!valida(decisao({ vigenciaFim: decisao().vigenciaInicio })));
    assert.ok(!valida({ ...decisao(), vigenciaFim: AGORA, vigenciaInicio: AMANHA }));
  });
});
