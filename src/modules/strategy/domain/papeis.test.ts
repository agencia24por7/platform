import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MemberRole } from '../../identity/domain/user.ts';
import { ACOES_DO_PLANO, podeExecutar, type AcaoDoPlano } from './papeis.ts';

const PAPEIS: readonly MemberRole[] = ['owner', 'admin', 'operator', 'viewer'];

const ESPERADO_NO_BANCO: Readonly<Record<AcaoDoPlano, readonly MemberRole[]>> = {
  ler: ['owner', 'admin', 'operator', 'viewer'],
  criar: ['owner', 'admin', 'operator'],
  editar: ['owner', 'admin', 'operator'],
  aplicar: ['owner', 'admin', 'operator'],
  cancelar: ['owner', 'admin', 'operator'],
  autorizar: ['owner', 'admin'],
  rejeitar: ['owner', 'admin'],
  revogar: ['owner', 'admin'],
};

describe('quem pode o quê no plano', () => {
  it('espelha a tabela de papéis do banco', () => {
    for (const acao of ACOES_DO_PLANO) {
      const quem = PAPEIS.filter((papel) => podeExecutar(acao, { tipo: 'pessoa', papel }));
      assert.deepEqual(quem, ESPERADO_NO_BANCO[acao], acao);
    }
  });

  it('viewer só lê', () => {
    for (const acao of ACOES_DO_PLANO) {
      assert.equal(podeExecutar(acao, { tipo: 'pessoa', papel: 'viewer' }), acao === 'ler');
    }
  });

  it('agente nunca aplica, autoriza, rejeita nem revoga', () => {
    for (const acao of ['aplicar', 'autorizar', 'rejeitar', 'revogar'] as const) {
      assert.equal(podeExecutar(acao, { tipo: 'agente' }), false, acao);
    }
  });

  it('agente lê, cria e edita', () => {
    for (const acao of ['ler', 'criar', 'editar'] as const) {
      assert.equal(podeExecutar(acao, { tipo: 'agente' }), true, acao);
    }
  });

  it('agente só cancela versão em rascunho (espelho do banco)', () => {
    const agente = { tipo: 'agente' } as const;
    assert.equal(podeExecutar('cancelar', agente, 'rascunho'), true);
    for (const status of ['proposto', 'vigente', 'superado', 'revogado', 'rejeitado', 'cancelado'] as const) {
      assert.equal(podeExecutar('cancelar', agente, status), false, status);
    }
    assert.equal(podeExecutar('cancelar', agente), false);
  });

  it('pessoa cancela rascunho e proposto sem depender do status informado', () => {
    assert.equal(podeExecutar('cancelar', { tipo: 'pessoa', papel: 'operator' }, 'proposto'), true);
    assert.equal(podeExecutar('cancelar', { tipo: 'pessoa', papel: 'viewer' }, 'rascunho'), false);
  });
});
