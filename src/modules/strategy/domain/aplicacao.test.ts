import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { podeAplicar, passouPeloComite, type EventoDaCadeia, type EventosPorVersao, type EventoParaAplicar } from './aplicacao.ts';

const parecer: EventoParaAplicar = { tipo: 'parecer' };
const ajuste = (respondeA: string | null = 'v0'): EventoParaAplicar => ({ tipo: 'ajuste', respondeA });
const gate = (resultado: 'aprovado' | 'reprovado'): EventoParaAplicar => ({ tipo: 'gate', resultado });

const faltas = (eventosDaVersao: EventoParaAplicar[], respondidaPassouPeloComite = false) => {
  const r = podeAplicar({ eventosDaVersao, respondidaPassouPeloComite });
  return r.ok ? [] : r.error;
};

describe('podeAplicar', () => {
  it('aceita parecer próprio seguido de gate aprovado', () => {
    assert.deepEqual(podeAplicar({ eventosDaVersao: [parecer, gate('aprovado')], respondidaPassouPeloComite: false }), { ok: true, value: true });
  });

  it('aceita ajuste que responde a versão com parecer, mesmo sem parecer próprio', () => {
    assert.deepEqual(faltas([ajuste(), gate('aprovado')], true), []);
  });

  it('recusa ajuste que responde a versão sem parecer, ou ajuste sem responde_a', () => {
    assert.deepEqual(faltas([ajuste(), gate('aprovado')], false), ['falta_parecer']);
    assert.deepEqual(faltas([ajuste(null), gate('aprovado')], true), ['falta_parecer']);
  });

  it('recusa versão sem nenhum evento: falta parecer e gate', () => {
    assert.deepEqual(faltas([]), ['falta_parecer', 'falta_gate']);
  });

  it('recusa gate ausente', () => {
    assert.deepEqual(faltas([parecer]), ['falta_gate']);
  });

  it('recusa gate mais recente reprovado, mesmo com aprovado antes', () => {
    assert.deepEqual(faltas([parecer, gate('aprovado'), gate('reprovado')]), ['gate_reprovado']);
  });

  it('aceita gate aprovado mais recente mesmo com reprovado antes', () => {
    assert.deepEqual(faltas([parecer, gate('reprovado'), gate('aprovado')]), []);
  });

  it('recusa gate anterior a parecer ou a ajuste', () => {
    assert.deepEqual(faltas([gate('aprovado'), parecer]), ['gate_anterior_ao_parecer']);
    assert.deepEqual(faltas([parecer, gate('aprovado'), ajuste()]), ['gate_anterior_ao_parecer']);
  });

  it('acumula o que falta', () => {
    assert.deepEqual(faltas([gate('reprovado'), parecer]), ['gate_reprovado', 'gate_anterior_ao_parecer']);
  });

  it('ignora eventos de outro tipo', () => {
    assert.deepEqual(faltas([parecer, gate('aprovado'), { tipo: 'outro' }]), []);
  });
});

const ev = (tipo: string, payload: Record<string, unknown> = {}, atorTipo = 'agente', agentRunId: string | null = atorTipo === 'agente' ? 'R1' : null): EventoDaCadeia => ({
  tipo,
  atorTipo,
  agentRunId,
  payload,
});
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const U5 = '55555555-5555-4555-8555-555555555555';
const substituiu = (por: string) => ev('cancelada', { motivo: 'substituida_por_edicao', por }, 'sistema');

describe('passouPeloComite em cadeia', () => {
  it('aceita parecer próprio', () => {
    assert.equal(passouPeloComite(U1, new Map([[U1, [ev('parecer')]]])), true);
  });

  it('aceita v1 (pareceres) → v2 (ajuste responde v1) → v3 (ajuste responde v2)', () => {
    const eventos: EventosPorVersao = new Map([
      [U1, [ev('parecer'), substituiu(U2)]],
      [U2, [ev('ajuste', { responde_a: U1 }), ev('gate'), substituiu(U3)]],
      [U3, [ev('ajuste', { responde_a: U2 })]],
    ]);
    assert.equal(passouPeloComite(U3, eventos), true);
  });

  it('recusa versão que responde a uma versão antiga e não à que substituiu', () => {
    const eventos: EventosPorVersao = new Map([
      [U1, [ev('parecer'), substituiu(U2)]],
      [U2, [ev('ajuste', { responde_a: U1 }), substituiu(U3)]],
      [U3, [ev('ajuste', { responde_a: U2 }), substituiu(U5)]],
      [U5, [ev('ajuste', { responde_a: U1 })]],
    ]);
    assert.equal(passouPeloComite(U5, eventos), false);
  });

  it('recusa cadeia sem parecer na raiz, ajuste sem substituição e redigida', () => {
    const semRaiz: EventosPorVersao = new Map([
      [U1, [substituiu(U2)]],
      [U2, [ev('ajuste', { responde_a: U1 })]],
    ]);
    assert.equal(passouPeloComite(U2, semRaiz), false);
    const semSubstituicao: EventosPorVersao = new Map([
      [U1, [ev('parecer')]],
      [U2, [ev('ajuste', { responde_a: U1 })]],
    ]);
    assert.equal(passouPeloComite(U2, semSubstituicao), false);
    const redigida: EventosPorVersao = new Map([
      [U1, [ev('parecer'), ev('cancelada', { redigido: true }, 'sistema')]],
      [U2, [ev('ajuste', { responde_a: U1 })]],
    ]);
    assert.equal(passouPeloComite(U2, redigida), false);
  });

  it('falha fechada ao estourar 10 saltos e não entra em laço com ciclo', () => {
    const ids = Array.from({ length: 13 }, (_, i) => `${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000000`);
    const longa = new Map<string, EventoDaCadeia[]>();
    ids.forEach((id, i) => {
      const proxima = ids[i + 1];
      const anterior = ids[i - 1];
      longa.set(id, [...(anterior ? [ev('ajuste', { responde_a: anterior })] : [ev('parecer')]), ...(proxima ? [substituiu(proxima)] : [])]);
    });
    assert.equal(passouPeloComite(ids[10]!, longa), true);
    assert.equal(passouPeloComite(ids[12]!, longa), false);
    const ciclo: EventosPorVersao = new Map([
      [U1, [ev('ajuste', { responde_a: U2 }), substituiu(U2)]],
      [U2, [ev('ajuste', { responde_a: U1 }), substituiu(U1)]],
    ]);
    assert.equal(passouPeloComite(U1, ciclo), false);
  });
});

describe('passouPeloComite exige uma execução só na cadeia', () => {
  const substituiu2 = (por: string) => ev('cancelada', { motivo: 'substituida_por_edicao', por }, 'sistema');

  it('recusa ajuste de outra execução que responde a versão cancelada pela primeira (V3 de R1, V4 de R2)', () => {
    const eventos: EventosPorVersao = new Map([
      [U1, [ev('parecer'), substituiu2(U2)]],
      [U2, [ev('ajuste', { responde_a: U1 }), substituiu2(U3)]],
      [U3, [ev('ajuste', { responde_a: U2 }, 'agente', 'R2')]],
    ]);
    assert.equal(passouPeloComite(U3, eventos), false);
    assert.equal(passouPeloComite(U2, eventos), true);
    assert.equal(passouPeloComite(U2, eventos, 'R2'), false);
  });

  it('recusa raiz com pareceres de mais de uma execução ou sem execução', () => {
    assert.equal(passouPeloComite(U1, new Map([[U1, [ev('parecer', {}, 'agente', 'R1'), ev('parecer', {}, 'agente', 'R2')]]])), false);
    assert.equal(passouPeloComite(U1, new Map([[U1, [ev('parecer', {}, 'agente', null)]]])), false);
  });

  it('aceita a raiz de autor pessoa com pareceres da execução corrente', () => {
    const eventos: EventosPorVersao = new Map([
      [U1, [ev('parecer', {}, 'agente', 'R9'), substituiu2(U2)]],
      [U2, [ev('ajuste', { responde_a: U1 }, 'agente', 'R9')]],
    ]);
    assert.equal(passouPeloComite(U2, eventos, 'R9'), true);
    assert.equal(passouPeloComite(U2, eventos, 'R1'), false);
  });

  it('versão com pareceres de execuções diferentes não conta como parecer próprio', () => {
    const r = podeAplicar({
      eventosDaVersao: [{ tipo: 'parecer', agentRunId: 'R1' }, { tipo: 'parecer', agentRunId: 'R2' }, { tipo: 'gate', resultado: 'aprovado' }],
      respondidaPassouPeloComite: false,
    });
    assert.equal(r.ok, false);
  });
});

describe('podeAplicar: o Gate é da mesma execução do Comitê', () => {
  const parecerDe = (run: string): EventoParaAplicar => ({ tipo: 'parecer', agentRunId: run });
  const gateDe = (run: string | null): EventoParaAplicar => ({ tipo: 'gate', resultado: 'aprovado', agentRunId: run });
  const faltasDe = (eventosDaVersao: EventoParaAplicar[], passou = false) => {
    const r = podeAplicar({ eventosDaVersao, respondidaPassouPeloComite: passou });
    return r.ok ? [] : r.error;
  };

  it('aceita o gate da mesma execução dos pareceres e recusa o de outra', () => {
    assert.deepEqual(faltasDe([parecerDe('R1'), gateDe('R1')]), []);
    assert.deepEqual(faltasDe([parecerDe('R1'), gateDe('R2')]), ['gate_de_outra_execucao']);
    assert.deepEqual(faltasDe([parecerDe('R1'), gateDe(null)]), ['gate_de_outra_execucao']);
  });

  it('com ajuste, o gate tem de ser da execução do ajuste', () => {
    const ajusteDe = (run: string): EventoParaAplicar => ({ tipo: 'ajuste', respondeA: 'v0', agentRunId: run });
    assert.deepEqual(faltasDe([ajusteDe('R1'), gateDe('R1')], true), []);
    assert.deepEqual(faltasDe([ajusteDe('R1'), gateDe('R2')], true), ['gate_de_outra_execucao']);
  });
});
