import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { vocabularioDe } from './vocabulario.ts';

describe('vocabulário por tipo de organização', () => {
  it('agência fala em clientes e pede ao cliente', () => {
    const v = vocabularioDe('agency');
    assert.equal(v.clientes, 'Clientes');
    assert.equal(v.rotuloDePedir, 'Pedir ao cliente');
    assert.equal(v.rotuloDaAcaoDeContexto, 'Enviar mapa');
    assert.ok(v.enviarMapaNoPerfil);
  });
  it('anunciante fala em negócios, convida e nunca manda mapa a si mesmo', () => {
    const v = vocabularioDe('advertiser');
    assert.equal(v.clientes, 'Negócios');
    assert.equal(v.rotuloDePedir, 'Convidar');
    assert.equal(v.rotuloDaAcaoDeContexto, 'Preencher contexto');
    assert.ok(!v.enviarMapaNoPerfil);
    assert.ok(!/Enviar mapa|Pedir ao cliente|agência|cliente/i.test(Object.values(v).join(' ')));
  });
});
