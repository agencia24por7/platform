import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { criarPodeRepetir, erroRepetivel, execucaoEncerradaSemConcluir, execucaoRepetivel } from './repeticaoDaExecucao.ts';

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

  it('criação cancelada pode ser repetida; cancelamento de outro tipo, não', () => {
    assert.equal(execucaoRepetivel({ tipo: 'criar', status: 'cancelada', erroCodigo: null }), true);
    assert.equal(execucaoRepetivel({ tipo: 'ajustar', status: 'cancelada', erroCodigo: null }), false);
    assert.equal(execucaoRepetivel({ tipo: 'revisar', status: 'cancelada', erroCodigo: null }), false);
  });

  it('falha só se repete com código repetível e nunca na correção do Gate', () => {
    assert.equal(execucaoRepetivel({ tipo: 'criar', status: 'falhou', erroCodigo: 'ia_saida_invalida' }), true);
    assert.equal(execucaoRepetivel({ tipo: 'criar', status: 'falhou', erroCodigo: 'gate_reprovado' }), false);
    assert.equal(execucaoRepetivel({ tipo: 'corrigir_gate', status: 'falhou', erroCodigo: 'ia_falha' }), false);
    assert.equal(execucaoRepetivel({ tipo: 'criar', status: 'concluida', erroCodigo: null }), false);
    assert.equal(execucaoRepetivel({ tipo: 'criar', status: 'rodando', erroCodigo: null }), false);
  });

  it('só falha e cancelamento contam como execução encerrada sem concluir', () => {
    assert.equal(execucaoEncerradaSemConcluir({ status: 'falhou' }), true);
    assert.equal(execucaoEncerradaSemConcluir({ status: 'cancelada' }), true);
    assert.equal(execucaoEncerradaSemConcluir({ status: 'concluida' }), false);
    assert.equal(execucaoEncerradaSemConcluir({ status: 'pendente' }), false);
  });
});
