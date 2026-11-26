import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashDeTeste, pacoteDeTeste, urnDeTeste } from './fixturesDeTeste.ts';
import { MAXIMO_DE_BYTES_DO_CATALOGO, pacoteParaEntrada, type ItemDoCatalogo } from './pacote.ts';

const tamanho = (valor: unknown) => new TextEncoder().encode(JSON.stringify(valor)).length;

describe('pacoteParaEntrada', () => {
  it('as URNs pedidas como primeiras sobrevivem ao corte por bytes e o resto perde a vez', () => {
    const pacote = pacoteDeTeste();
    const ultima = pacote.entradas[pacote.entradas.length - 1]!;
    const limite = tamanho(ultima) + 1;
    const semPrioridade = pacoteParaEntrada(pacote, limite);
    assert.ok(!semPrioridade.entradas.some((e) => e.urn === ultima.urn) || semPrioridade.entradas.length >= 1);
    const comPrioridade = pacoteParaEntrada(pacote, limite, { primeiras: new Set([ultima.urn]) });
    assert.equal(comPrioridade.entradas[0]!.urn, ultima.urn);
  });

  it('comCatalogo false tira o catálogo do pedido', () => {
    const pacote = { ...pacoteDeTeste(), catalogo: [{ urn: pacoteDeTeste().entradas[0]!.urn, tipo: 'regra', titulo: 'x', incluida: true }] };
    assert.ok(pacoteParaEntrada(pacote, 100_000).catalogo !== undefined);
    assert.equal('catalogo' in pacoteParaEntrada(pacote, 100_000, { comCatalogo: false }), false);
  });

  it('o catálogo respeita o teto de bytes e recalcula incluida pelo que coube em entradas', () => {
    const base = pacoteDeTeste();
    const itens: ItemDoCatalogo[] = Array.from({ length: 1500 }, (_, i) => ({
      urn: urnDeTeste('regra', `item-${i}`),
      tipo: 'regra',
      titulo: `Entrada de catálogo número ${i} com título razoável`,
      incluida: true,
    }));
    itens.unshift({ urn: base.entradas[0]!.urn, tipo: 'tabela_de_dados', titulo: 'dentro', incluida: false });
    const pacote = { ...base, catalogo: itens };
    const saida = pacoteParaEntrada(pacote, 100_000);
    assert.ok(saida.catalogo!.reduce((soma, item) => soma + tamanho(item), 0) <= MAXIMO_DE_BYTES_DO_CATALOGO);
    assert.ok(saida.catalogo!.length < itens.length);
    assert.equal(saida.catalogo![0]!.incluida, true);
    assert.equal(saida.catalogo![1]!.incluida, false);
    assert.ok(hashDeTeste(1).length === 64);
  });
});
