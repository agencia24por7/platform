import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { avisoDoConvite, plataformasQueNaoUso, situacaoDoItem } from './conviteVisao.ts';

describe('visão do convite público', () => {
  it('usa os mesmos estados com rótulo de uma palavra', () => {
    assert.equal(situacaoDoItem('completed', false).rotulo, 'Conectada');
    assert.equal(situacaoDoItem('pending', true).rotulo, 'Dispensada');
    assert.equal(situacaoDoItem('pending', false).rotulo, 'Pendente');
    assert.equal(situacaoDoItem('expired', false).icone, 'atencao');
    assert.equal(situacaoDoItem('closed', false).rotulo, 'Encerrada');
  });
  it('só aceita plataformas do convite em "não uso"', () => {
    assert.deepEqual(plataformasQueNaoUso('meta,google,meta,x', ['meta', 'google']), ['meta', 'google']);
    assert.deepEqual(plataformasQueNaoUso(undefined, ['meta']), []);
  });
  it('autorização negada e sem permissão deixam tentar de novo; convite expirado não', () => {
    assert.equal(avisoDoConvite('autorizacao_negada', 'meta')?.podeTentarDeNovo, true);
    assert.equal(avisoDoConvite('autorizacao_recusada', 'google')?.plataforma, 'google');
    assert.equal(avisoDoConvite('convite_invalido', undefined)?.podeTentarDeNovo, false);
    assert.equal(avisoDoConvite(undefined, undefined), null);
  });
});
