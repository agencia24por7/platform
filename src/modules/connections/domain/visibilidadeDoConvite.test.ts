import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { podeVerConviteDeIntegracao } from './visibilidadeDoConvite.ts';

describe('quem vê o endereço do convite de integração', () => {
  it('administrador da organização inteira vê', () => {
    assert.equal(podeVerConviteDeIntegracao(true, null), true);
  });

  it('administrador recortado a clientes não vê', () => {
    assert.equal(podeVerConviteDeIntegracao(true, ['3f2504e0-4f89-11d3-9a0c-0305e82c3301']), false);
  });

  it('recorte vazio também não vê', () => {
    assert.equal(podeVerConviteDeIntegracao(true, []), false);
  });

  it('quem não administra não vê, mesmo com a organização inteira', () => {
    assert.equal(podeVerConviteDeIntegracao(false, null), false);
  });
});
