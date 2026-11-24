import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOGO } from './catalogo.ts';
import { calcularCompletude } from './completude.ts';
import { combinarProntidao } from './prontidao.ts';

const vazio = { campos: [], itens: [], arquivos: [] };

describe('catálogo versão 2', () => {
  it('os campos normativos de J e K saíram do catálogo', () => {
    const chaves = new Set(CATALOGO.flatMap((s) => s.campos.map((c) => c.key)));
    for (const saiu of ['orcamento_mensal_total', 'regras_regulatorias', 'o_que_nao_pode_ser_dito', 'quem_aprova', 'prazo_de_aprovacao']) {
      assert.equal(chaves.has(saiu), false, saiu);
    }
    assert.equal(chaves.has('orcamento_marca_pct'), true);
    assert.equal(chaves.has('recursos_internos'), true);
  });

  it('a seção K sem campo essencial não trava a completude', () => {
    const restricoes = calcularCompletude(vazio).secoes.find((s) => s.secao === 'restricoes')!;
    assert.equal(restricoes.essenciaisTotal, 0);
    assert.equal(restricoes.essenciaisCompletos, true);
  });
});

describe('combinarProntidao', () => {
  it('soma as lacunas do Contexto e as de Regras', () => {
    const resultado = combinarProntidao(calcularCompletude(vazio), {
      essenciaisFaltando: [{ chave: 'investimento.teto_mensal', nome: 'Teto de investimento mensal' }],
    });
    assert.equal(resultado.pronto, false);
    assert.equal(resultado.contextoCompleto, false);
    assert.equal(resultado.regrasCompletas, false);
    assert.ok(resultado.lacunas.some((l) => l.origem === 'regras' && l.chave === 'investimento.teto_mensal'));
    assert.ok(resultado.lacunas.some((l) => l.origem === 'contexto'));
  });

  it('só Regras faltando deixa o Contexto completo', () => {
    const completo = { geral: 100, essenciaisCompletos: true, secoes: [] };
    const resultado = combinarProntidao(completo, { essenciaisFaltando: [{ chave: 'eficiencia.cac_maximo', nome: 'CAC' }] });
    assert.deepEqual([resultado.contextoCompleto, resultado.regrasCompletas, resultado.pronto], [true, false, false]);
    assert.equal(combinarProntidao(completo, { essenciaisFaltando: [] }).pronto, true);
  });
});
