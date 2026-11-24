import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { autorizar, proximoStatus, statusAoRegistrar, transitar, type Ator } from './transicoes.ts';

const viewer: Ator = { origem: 'agencia', papel: 'viewer' };
const operator: Ator = { origem: 'agencia', papel: 'operator' };
const admin: Ator = { origem: 'agencia', papel: 'admin' };
const agente: Ator = { origem: 'agente' };
const cliente: Ator = { origem: 'cliente', papel: 'operator' };

const codigo = (resultado: { ok: boolean; error?: { codigo: string } }) => (resultado.ok ? null : resultado.error?.codigo);

describe('máquina de estados', () => {
  it('só existem as transições do ADR', () => {
    assert.deepEqual(proximoStatus('proposta', 'efetivar'), { ok: true, value: 'vigente' });
    assert.deepEqual(proximoStatus('proposta', 'rejeitar'), { ok: true, value: 'rejeitada' });
    assert.deepEqual(proximoStatus('vigente', 'superar'), { ok: true, value: 'superada' });
    assert.deepEqual(proximoStatus('vigente', 'revogar'), { ok: true, value: 'revogada' });
    assert.equal(codigo(proximoStatus('superada', 'revogar')), 'transicao_invalida');
    assert.equal(codigo(proximoStatus('proposta', 'revogar')), 'transicao_invalida');
    assert.equal(codigo(proximoStatus('rejeitada', 'efetivar')), 'transicao_invalida');
    assert.equal(codigo(proximoStatus('vigente', 'efetivar')), 'transicao_invalida');
  });
});

describe('quem pode o quê', () => {
  it('viewer não faz nada', () => {
    for (const natureza of ['limite', 'regra', 'decisao'] as const) {
      assert.equal(codigo(autorizar(viewer, 'registrar', natureza)), 'sem_permissao');
    }
  });
  it('operator mexe em regra e decisão, não em limite', () => {
    for (const acao of ['registrar', 'efetivar', 'rejeitar', 'superar', 'revogar'] as const) {
      assert.ok(autorizar(operator, acao, 'regra').ok);
      assert.ok(autorizar(operator, acao, 'decisao').ok);
      assert.equal(codigo(autorizar(operator, acao, 'limite')), 'sem_permissao');
    }
  });
  it('admin faz tudo, inclusive limite', () => {
    for (const acao of ['registrar', 'efetivar', 'rejeitar', 'superar', 'revogar'] as const) {
      assert.ok(autorizar(admin, acao, 'limite').ok);
    }
  });
  it('agente nunca efetiva, altera nem revoga limite ou regra', () => {
    for (const natureza of ['limite', 'regra'] as const) {
      for (const acao of ['efetivar', 'rejeitar', 'superar', 'revogar'] as const) {
        assert.equal(codigo(transitar(agente, 'proposta', acao, natureza)), 'sem_permissao');
        assert.equal(codigo(transitar(agente, 'vigente', acao, natureza)), 'sem_permissao');
      }
    }
  });
});

describe('status ao registrar', () => {
  it('pessoa da agência registra vigente conforme o papel', () => {
    assert.deepEqual(statusAoRegistrar(admin, { natureza: 'limite', categoria: 'investimento' }), { ok: true, value: 'vigente' });
    assert.deepEqual(statusAoRegistrar(operator, { natureza: 'regra', categoria: 'governanca' }), { ok: true, value: 'vigente' });
    assert.equal(codigo(statusAoRegistrar(operator, { natureza: 'limite', categoria: 'investimento' })), 'sem_permissao');
    assert.equal(codigo(statusAoRegistrar(viewer, { natureza: 'decisao', categoria: 'processo' })), 'sem_permissao');
  });
  it('agente: decisão de processo vigente; limite e regra só proposta; outra decisão negada', () => {
    assert.deepEqual(statusAoRegistrar(agente, { natureza: 'decisao', categoria: 'processo' }), { ok: true, value: 'vigente' });
    assert.deepEqual(statusAoRegistrar(agente, { natureza: 'limite', categoria: 'investimento' }), { ok: true, value: 'proposta' });
    assert.deepEqual(statusAoRegistrar(agente, { natureza: 'regra', categoria: 'processo' }), { ok: true, value: 'proposta' });
    assert.equal(codigo(statusAoRegistrar(agente, { natureza: 'decisao', categoria: 'governanca' })), 'agente_nao_declara_esta_decisao');
  });
  it('cliente só propõe e não muda ciclo de vida', () => {
    assert.deepEqual(statusAoRegistrar(cliente, { natureza: 'regra', categoria: 'publico' }), { ok: true, value: 'proposta' });
    assert.equal(codigo(transitar(cliente, 'proposta', 'efetivar', 'regra')), 'sem_permissao');
  });
});
