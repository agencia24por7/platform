import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { criarPodeRepetir, erroRepetivel } from './repeticaoDaExecucao.ts';

describe('repetição da execução que falhou', () => {
  it('rascunho do próprio agente não impede repetir a criação', () => {
    assert.equal(criarPodeRepetir([{ status: 'rascunho', autorTipo: 'agente' }]), true);
    assert.equal(criarPodeRepetir([]), true);
  });

  it('versão da pessoa ou versão vigente impede repetir a criação', () => {
    assert.equal(criarPodeRepetir([{ status: 'rascunho', autorTipo: 'usuario' }]), false);
    assert.equal(criarPodeRepetir([{ status: 'vigente', autorTipo: 'agente' }]), false);
  });

  it('só código conhecido como repetível permite repetir', () => {
    assert.equal(erroRepetivel('ia_saida_invalida'), true);
    assert.equal(erroRepetivel('gate_reprovado'), false);
    assert.equal(erroRepetivel('ia_nao_configurada'), false);
    assert.equal(erroRepetivel('codigo_novo'), false);
    assert.equal(erroRepetivel(null), false);
  });
});
