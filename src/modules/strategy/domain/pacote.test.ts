import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashDeTeste, pacoteDeTeste, urnDeTeste } from './fixturesDeTeste.ts';
import { codigosDoPacote } from './codigosCurtos.ts';
import { MAXIMO_DE_BYTES_DO_CATALOGO, pacoteParaEntrada, pacotesComPrefixoComum, type ItemDoCatalogo } from './pacote.ts';

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

  it('entradas e itens do catálogo levam o ref do pacote inteiro, mesmo depois do corte por bytes', () => {
    const base = pacoteDeTeste();
    const catalogo = base.entradas.map((e) => ({ urn: e.urn, tipo: 'regra', titulo: 'x', incluida: true }));
    const pacote = { ...base, catalogo };
    const { codigoDaUrn } = codigosDoPacote(pacote);
    const ultima = base.entradas[base.entradas.length - 1]!;
    const saida = pacoteParaEntrada(pacote, tamanho(ultima) + 1, { primeiras: new Set([ultima.urn]) });
    assert.equal(saida.entradas[0]!.ref, codigoDaUrn.get(ultima.urn));
    for (const item of saida.catalogo!) assert.equal(item.ref, codigoDaUrn.get(item.urn));
  });
});

describe('pacotesComPrefixoComum (ADR 0076)', () => {
  const base = pacoteDeTeste();
  const extras = Array.from({ length: 40 }, (_, i) => ({
    urn: urnDeTeste('conhecimento', `extra-${i}`),
    hash: hashDeTeste(100 + i),
    tipo: 'conhecimento' as const,
    titulo: `Evidência extra ${i}`,
    resumo: `Texto da evidência extra ${i}. `.repeat(8),
    somenteMetadados: false,
  }));
  const pacote = { ...base, entradas: [...base.entradas, ...extras] };
  const urns = (entradas: readonly { urn: string }[]) => entradas.map((entrada) => entrada.urn);
  const pedidos = [
    { primeiras: new Set([extras[39]!.urn, extras[38]!.urn]), comCatalogo: false },
    { primeiras: new Set([extras[20]!.urn]), comCatalogo: false },
    { primeiras: new Set<string>(), comCatalogo: false },
  ];

  it('cada recorte mantém exatamente as entradas do recorte individual: só a ordem muda', () => {
    for (const limite of [1_000_000, tamanho(pacote.entradas) / 2, tamanho(pacote.entradas) / 5]) {
      const juntos = pacotesComPrefixoComum(pacote, limite, pedidos);
      pedidos.forEach((pedido, indice) => {
        const sozinho = pacoteParaEntrada(pacote, limite, pedido);
        assert.deepEqual([...urns(juntos[indice]!.entradas)].sort(), [...urns(sozinho.entradas)].sort());
        assert.equal(juntos[indice]!.omitidasPorTamanho, sozinho.omitidasPorTamanho);
        assert.equal('catalogo' in juntos[indice]!, false);
      });
    }
  });

  it('as entradas comuns a todos vêm primeiro e na mesma ordem em todos os recortes; as próprias de cada um vêm depois', () => {
    const limite = tamanho(pacote.entradas) / 2;
    const juntos = pacotesComPrefixoComum(pacote, limite, pedidos);
    const conjuntos = juntos.map((recorte) => new Set(urns(recorte.entradas)));
    const comuns = urns(pacote.entradas).filter((urn) => conjuntos.every((conjunto) => conjunto.has(urn)));
    assert.ok(comuns.length > 0);
    assert.ok(juntos.some((recorte) => recorte.entradas.length > comuns.length), 'o corte por bytes deixou entradas próprias');
    for (const recorte of juntos) {
      assert.deepEqual(new Set(urns(recorte.entradas).slice(0, comuns.length)), new Set(comuns));
      assert.deepEqual(urns(recorte.entradas).slice(0, comuns.length), urns(juntos[0]!.entradas).slice(0, comuns.length));
    }
  });

  it('URN repetida no pacote não some nem vira entrada vazia: cada recorte mantém a mesma quantidade do recorte individual', () => {
    const repetido = { ...pacote, entradas: [...pacote.entradas, { ...extras[0]!, titulo: 'Segunda versão da mesma URN' }] };
    const juntos = pacotesComPrefixoComum(repetido, 1_000_000, pedidos);
    pedidos.forEach((pedido, indice) => {
      const sozinho = pacoteParaEntrada(repetido, 1_000_000, pedido);
      assert.equal(juntos[indice]!.entradas.length, sozinho.entradas.length);
      assert.deepEqual(juntos[indice]!.entradas.map((entrada) => entrada.titulo).sort(), sozinho.entradas.map((entrada) => entrada.titulo).sort());
      assert.ok(juntos[indice]!.entradas.every((entrada) => entrada !== undefined));
    });
    assert.equal(JSON.stringify(juntos[1]), JSON.stringify(juntos[0]));
  });

  it('com tudo cabendo, todos os recortes saem idênticos; sem pedidos, devolve lista vazia', () => {
    const juntos = pacotesComPrefixoComum(pacote, 1_000_000, pedidos);
    assert.equal(JSON.stringify(juntos[1]), JSON.stringify(juntos[0]));
    assert.equal(JSON.stringify(juntos[2]), JSON.stringify(juntos[0]));
    assert.deepEqual(pacotesComPrefixoComum(pacote, 1_000_000, []), []);
  });
});
