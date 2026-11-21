import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOGO } from './catalogo.ts';
import { traduzirCatalogo } from './vocabulario.ts';

describe('catálogo traduzido por tipo de organização', () => {
  it('agência recebe o mesmo catálogo', () => {
    assert.equal(traduzirCatalogo(CATALOGO, 'agency'), CATALOGO);
  });
  it('anunciante troca só o texto que fala da relação agência e cliente', () => {
    const texto = JSON.stringify(traduzirCatalogo(CATALOGO, 'advertiser'));
    assert.ok(!texto.includes('enviado ao cliente'));
    assert.ok(!texto.includes('concedidos à agência'));
    assert.ok(!texto.includes('Quem é o cliente, o que faz'));
    assert.ok(texto.includes('Quem é o negócio, o que faz'));
  });
  it('mantém chaves e os textos sobre os clientes do negócio', () => {
    const traduzido = traduzirCatalogo(CATALOGO, 'advertiser');
    assert.deepEqual(traduzido.map((s) => s.key), CATALOGO.map((s) => s.key));
    assert.ok(JSON.stringify(traduzido).includes('Quem é o melhor cliente hoje?'));
    assert.ok(JSON.stringify(traduzido).includes('descricao_do_cliente'));
  });
});
