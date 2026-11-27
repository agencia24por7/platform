import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EFEITO_DOS_EVENTOS,
  ROTULO_DO_STATUS,
  STATUS_DA_VERSAO,
  TIPOS_DE_EVENTO,
  TRANSICOES_DE_STATUS,
  podeTransitar,
  statusAberto,
  statusAposEvento,
  statusFinal,
} from './status.ts';

describe('status da versão (espelho do banco 0143)', () => {
  it('tem os sete status e os rótulos de tela', () => {
    assert.deepEqual([...STATUS_DA_VERSAO], ['rascunho', 'proposto', 'vigente', 'superado', 'revogado', 'rejeitado', 'cancelado']);
    assert.deepEqual(ROTULO_DO_STATUS, {
      rascunho: 'Em rascunho',
      proposto: 'Em autorização',
      vigente: 'Autorizado',
      superado: 'Substituído',
      revogado: 'Revogado',
      rejeitado: 'Rejeitado',
      cancelado: 'Cancelado',
    });
  });

  it('a tabela de transições é idêntica à do gatilho do banco', () => {
    const esperadas = [
      'rascunho>proposto',
      'rascunho>cancelado',
      'proposto>cancelado',
      'proposto>vigente',
      'proposto>rejeitado',
      'vigente>superado',
      'vigente>revogado',
    ].sort();
    const atuais = STATUS_DA_VERSAO.flatMap((de) => TRANSICOES_DE_STATUS[de].map((para) => `${de}>${para}`)).sort();
    assert.deepEqual(atuais, esperadas);
  });

  it('podeTransitar aceita só o que a tabela permite', () => {
    assert.equal(podeTransitar('rascunho', 'proposto'), true);
    assert.equal(podeTransitar('rascunho', 'vigente'), false);
    assert.equal(podeTransitar('vigente', 'cancelado'), false);
    assert.equal(podeTransitar('cancelado', 'rascunho'), false);
  });

  it('aberto é rascunho ou proposto; final é o que não sai', () => {
    assert.deepEqual(STATUS_DA_VERSAO.filter(statusAberto), ['rascunho', 'proposto']);
    assert.deepEqual(STATUS_DA_VERSAO.filter(statusFinal), ['superado', 'revogado', 'rejeitado', 'cancelado']);
  });

  it('tem os mesmos tipos de evento do banco', () => {
    assert.deepEqual(
      [...TIPOS_DE_EVENTO],
      ['proposta', 'parecer', 'ajuste', 'gate', 'veredito_juiz', 'cancelada', 'efetivada', 'rejeitada', 'revogada', 'revisao_aberta', 'impacto_anotado', 'redigida'],
    );
  });

  it('cada evento causa a transição do banco', () => {
    const leva = Object.fromEntries(TIPOS_DE_EVENTO.map((e) => [e, EFEITO_DOS_EVENTOS[e].leva]));
    assert.deepEqual(leva, {
      proposta: 'proposto',
      parecer: null,
      ajuste: null,
      gate: null,
      veredito_juiz: null,
      cancelada: 'cancelado',
      efetivada: 'vigente',
      rejeitada: 'rejeitado',
      revogada: 'revogado',
      revisao_aberta: null,
      impacto_anotado: null,
      redigida: null,
    });
    assert.deepEqual(TIPOS_DE_EVENTO.filter((e) => EFEITO_DOS_EVENTOS[e].superaVigenteAnterior), ['efetivada']);
  });

  it('toda transição causada por evento existe na tabela', () => {
    for (const evento of TIPOS_DE_EVENTO) {
      const efeito = EFEITO_DOS_EVENTOS[evento];
      if (efeito.leva === null) continue;
      for (const de of efeito.aceitaEm) assert.equal(podeTransitar(de, efeito.leva), true, `${evento}: ${de}>${efeito.leva}`);
    }
  });

  it('statusAposEvento aplica o evento ou recusa', () => {
    assert.deepEqual(statusAposEvento('rascunho', 'proposta'), { ok: true, value: 'proposto' });
    assert.deepEqual(statusAposEvento('proposto', 'cancelada'), { ok: true, value: 'cancelado' });
    assert.deepEqual(statusAposEvento('rascunho', 'parecer'), { ok: true, value: 'rascunho' });
    assert.deepEqual(statusAposEvento('vigente', 'impacto_anotado'), { ok: true, value: 'vigente' });
    for (const [status, evento] of [
      ['proposto', 'parecer'],
      ['vigente', 'gate'],
      ['rascunho', 'efetivada'],
      ['vigente', 'cancelada'],
      ['proposto', 'revogada'],
    ] as const) {
      assert.equal(statusAposEvento(status, evento).ok, false, `${status} ${evento}`);
    }
  });
});
