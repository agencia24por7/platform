import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOGO, type CampoSimples } from './catalogo.ts';
import { textoDoValor } from './leitura.ts';

const campos = CATALOGO.flatMap((secao) => secao.campos).filter((campo): campo is CampoSimples => campo.tipo !== 'lista');
const doTipo = <T extends CampoSimples['tipo']>(tipo: T) => campos.find((campo) => campo.tipo === tipo) as Extract<CampoSimples, { tipo: T }>;

describe('texto do valor em modo leitura', () => {
  it('vazio é nulo em qualquer tipo, para o campo abrir em edição', () => {
    for (const valor of [null, undefined, '', '   ', []]) assert.equal(textoDoValor(doTipo('texto'), valor), null);
    assert.equal(textoDoValor(doTipo('multipla'), []), null);
  });

  it('seleção e múltipla mostram o rótulo da opção e mantêm o texto de "outro"', () => {
    const selecao = doTipo('selecao');
    const opcao = selecao.opcoes[0]!;
    assert.equal(textoDoValor(selecao, opcao.valor), opcao.rotulo);
    assert.equal(textoDoValor(selecao, 'algo digitado'), 'algo digitado');
    const multipla = doTipo('multipla');
    assert.equal(textoDoValor(multipla, [multipla.opcoes[0]!.valor, 'livre']), `${multipla.opcoes[0]!.rotulo}, livre`);
  });

  it('dinheiro em centavos vira reais, escala mostra os extremos e booleano vira Sim ou Não', () => {
    assert.match(textoDoValor(doTipo('dinheiro'), 150000) ?? '', /1\.500,00/);
    const escala = doTipo('escala');
    assert.equal(textoDoValor(escala, 4), `4 de 5 · ${escala.extremos[0]} ↔ ${escala.extremos[1]}`);
    const booleano = campos.find((campo) => campo.tipo === 'booleano');
    if (booleano) {
      assert.equal(textoDoValor(booleano, true), 'Sim');
      assert.equal(textoDoValor(booleano, false), 'Não');
    }
  });
});

describe('texto do valor com dado inesperado', () => {
  it('objeto num campo de texto vira JSON legível, não [object Object]', () => {
    const texto = CATALOGO.flatMap((secao) => secao.campos).find((campo): campo is CampoSimples => campo.tipo === 'texto')!;
    assert.equal(textoDoValor(texto, { a: 1 }), '{"a":1}');
  });
});
