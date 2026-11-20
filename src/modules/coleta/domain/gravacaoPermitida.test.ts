import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recusaDaGravacao } from './gravacaoPermitida.ts';

describe('gravar só em coleta aberta de cliente não excluído', () => {
  it('coleta inexistente é not_found', () => {
    assert.equal(recusaDaGravacao(null)?.codigo, 'not_found');
  });

  it('cliente excluído é not_found, mesmo com a coleta aberta', () => {
    assert.equal(recusaDaGravacao({ coletaStatus: 'running', clienteExcluido: true })?.codigo, 'not_found');
  });

  it('coleta fechada é conflict', () => {
    for (const status of ['succeeded', 'partial', 'failed']) {
      assert.equal(recusaDaGravacao({ coletaStatus: status, clienteExcluido: false })?.codigo, 'conflict');
    }
  });

  it('coleta running de cliente ativo grava', () => {
    assert.equal(recusaDaGravacao({ coletaStatus: 'running', clienteExcluido: false }), null);
  });
});
