import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { idValido } from './enderecos.ts';
import { lerPedidoAoCliente, lerPedidoDeLink } from './pedido.ts';

const valido = { plataformas: ['meta'], incluirMapa: true, secoes: ['empresa'], expiraEmDias: 30, nota: '', conviteDeIntegracaoId: null };

describe('pedido ao cliente validado antes de qualquer acesso', () => {
  it('aceita o pedido que a tela monta', () => {
    assert.equal(lerPedidoAoCliente(valido).ok, true);
    assert.equal(lerPedidoDeLink({ secoes: ['empresa'], expiraEmDias: 7, nota: 'oi', conviteDeIntegracaoId: null }).ok, true);
  });
  it('recusa formato errado sem lançar erro', () => {
    for (const ruim of [undefined, null, 'x', 7, [], {}, { ...valido, secoes: 'empresa' }, { ...valido, expiraEmDias: 0 }, { ...valido, expiraEmDias: 1.5 }, { ...valido, nota: 'a'.repeat(501) }, { ...valido, extra: 1 }, { ...valido, plataformas: [1] }]) {
      assert.equal(lerPedidoAoCliente(ruim).ok, false, JSON.stringify(ruim));
    }
    assert.equal(lerPedidoDeLink(undefined).ok, false);
  });
  it('id de cliente só vale se for texto no formato de uuid', () => {
    for (const ruim of [undefined, null, 1, {}, ['95ec64b4-c5b9-43ff-909d-d258d91e8b7c']]) assert.equal(idValido(ruim), false);
    assert.equal(idValido('95ec64b4-c5b9-43ff-909d-d258d91e8b7c'), true);
  });
});
