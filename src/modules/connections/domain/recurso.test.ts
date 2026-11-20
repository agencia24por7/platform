import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recusaParaDesvincular, recusaParaMover, recusaParaVincular, type RecursoAvaliado } from './recurso.ts';

const ativo = { id: 'c1', status: 'active' } as const;
const pausado = { id: 'c2', status: 'paused' } as const;
const descoberto: RecursoAvaliado = { platform: 'ga4', state: 'discovered', clientId: null };
const vinculado: RecursoAvaliado = { platform: 'searchconsole', state: 'linked', clientId: 'c1' };

describe('vincular recurso', () => {
  it('operador vincula recurso descoberto a cliente ativo', () => {
    assert.equal(recusaParaVincular('operator', descoberto, ativo), null);
  });

  it('leitor não vincula', () => {
    assert.equal(recusaParaVincular('viewer', descoberto, ativo)?.codigo, 'forbidden');
  });

  it('conta de anúncio não passa por aqui', () => {
    const recusa = recusaParaVincular('admin', { platform: 'meta', state: 'discovered', clientId: null }, ativo);
    assert.equal(recusa?.codigo, 'validation');
  });

  it('a conta do RD Station guardada por chave vincula a cliente ativo', () => {
    const conta: RecursoAvaliado = { platform: 'rdstation', state: 'discovered', clientId: null };
    assert.equal(recusaParaVincular('operator', conta, ativo), null);
    const jaVinculada = recusaParaVincular('admin', { ...conta, state: 'linked', clientId: 'c1' }, ativo);
    assert.match(jaVinculada!.mensagem, /^Conta já tem dono/);
  });

  it('recurso já vinculado pede Mover, com o rótulo da plataforma', () => {
    const recusa = recusaParaVincular('admin', vinculado, ativo);
    assert.equal(recusa?.codigo, 'conflict');
    assert.match(recusa!.mensagem, /^Site já tem dono/);
  });

  it('recurso ignorado ou perdido não é oferecido', () => {
    assert.equal(recusaParaVincular('admin', { ...descoberto, state: 'lost' }, ativo)?.codigo, 'conflict');
  });

  it('cliente pausado ou de outra organização não recebe recurso', () => {
    assert.equal(recusaParaVincular('admin', descoberto, pausado)?.codigo, 'validation');
    assert.equal(recusaParaVincular('admin', descoberto, null)?.codigo, 'validation');
  });

  it('recurso inexistente', () => {
    assert.equal(recusaParaVincular('admin', null, ativo)?.codigo, 'not_found');
  });
});

describe('mover recurso', () => {
  it('move recurso vinculado para cliente ativo', () => {
    assert.equal(recusaParaMover('operator', vinculado, { id: 'c3', status: 'active' }), null);
  });

  it('não move recurso sem dono', () => {
    assert.equal(recusaParaMover('operator', descoberto, ativo)?.codigo, 'conflict');
  });

  it('não move para cliente pausado', () => {
    assert.equal(recusaParaMover('operator', vinculado, pausado)?.codigo, 'validation');
  });
});

describe('desvincular recurso', () => {
  it('operador desvincula recurso vinculado', () => {
    assert.equal(recusaParaDesvincular('operator', vinculado), null);
  });

  it('leitor não desvincula', () => {
    assert.equal(recusaParaDesvincular('viewer', vinculado)?.codigo, 'forbidden');
  });

  it('recurso já sem cliente', () => {
    assert.equal(recusaParaDesvincular('admin', descoberto)?.codigo, 'conflict');
  });
});
