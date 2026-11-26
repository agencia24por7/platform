import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Ajuste } from '../comite/ajuste.ts';
import { parecer, ponto } from '../comite/fixturesDeParecer.ts';
import { PERSONAS } from '../comite/personas.ts';
import { contextoDeTeste } from '../fixturesDeTeste.ts';
import { checarComiteCompleto } from './comiteCompleto.ts';

const VERSAO = '55555555-5555-4555-8555-555555555555';
const todasAprovam = () => PERSONAS.map((p) => parecer(p.chave, 'aprova'));
const resposta = (persona: string, pontoId: string, decisao: 'acatado' | 'nao_acatado' = 'acatado') => ({ persona, pontoId, decisao, motivo: 'Motivo.' });

describe('gate: comite_completo', () => {
  it('aprova quando as nove personas aprovam sem ajuste', () => {
    assert.equal(checarComiteCompleto(contextoDeTeste({ pareceres: todasAprovam() })).resultado, 'aprovado');
  });

  it('falha fechada: sem pareceres no contexto reprova', () => {
    const contexto = { ...contextoDeTeste(), pareceres: undefined };
    assert.equal(checarComiteCompleto(contexto).resultado, 'reprovado');
    assert.equal(checarComiteCompleto(contextoDeTeste({ pareceres: [] })).onde.length, 9);
  });

  it('reprova persona sem parecer', () => {
    const r = checarComiteCompleto(contextoDeTeste({ pareceres: todasAprovam().filter((p) => p.persona !== 'sdr') }));
    assert.equal(r.resultado, 'reprovado');
    assert.deepEqual(r.onde, ['comite/sdr (sem parecer)']);
  });

  it('reprova parecer que pede ajuste sem ajuste', () => {
    const pareceres = [...todasAprovam().filter((p) => p.persona !== 'redator'), parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'campanhas')])];
    assert.equal(checarComiteCompleto(contextoDeTeste({ pareceres })).resultado, 'reprovado');
  });

  it('reprova ponto sem resposta e aprova quando todos são respondidos', () => {
    const pareceres = [...todasAprovam().filter((p) => p.persona !== 'redator'), parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'campanhas'), ponto('p2', 'criativos')])];
    const incompleto: Ajuste = { responde_a: VERSAO, respostas: [resposta('redator', 'p1')] };
    const r = checarComiteCompleto(contextoDeTeste({ pareceres, ajuste: incompleto }));
    assert.equal(r.resultado, 'reprovado');
    assert.deepEqual(r.onde, ['comite/redator/p2 (ponto_sem_resposta)']);
    const completo: Ajuste = { responde_a: VERSAO, respostas: [resposta('redator', 'p1'), resposta('redator', 'p2', 'nao_acatado')] };
    assert.equal(checarComiteCompleto(contextoDeTeste({ pareceres, ajuste: completo })).resultado, 'aprovado');
  });

  it('reprova reprovação obrigatória de risco_legal não acatada', () => {
    const pareceres = [...todasAprovam().filter((p) => p.persona !== 'risco_legal'), parecer('risco_legal', 'reprova', [ponto('p1', 'riscos_e_regras')])];
    const ajuste: Ajuste = { responde_a: VERSAO, respostas: [resposta('risco_legal', 'p1', 'nao_acatado')] };
    const r = checarComiteCompleto(contextoDeTeste({ pareceres, ajuste }));
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde[0]?.includes('pendencia_obrigatoria_nao_acatada'));
    const acatado: Ajuste = { responde_a: VERSAO, respostas: [resposta('risco_legal', 'p1')] };
    assert.equal(checarComiteCompleto(contextoDeTeste({ pareceres, ajuste: acatado })).resultado, 'aprovado');
  });

  it('reprova quando a cadeia do Comitê é de outra execução', () => {
    const r = checarComiteCompleto(contextoDeTeste({ comiteDaMesmaExecucao: false }));
    assert.equal(r.resultado, 'reprovado');
    assert.match(r.motivo, /outra execução/);
  });
});
