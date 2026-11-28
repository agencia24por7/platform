import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CompletudeDaSecao } from '../contexto/completude.ts';
import { PASSO_DO_DESTINO, resumoDoMapa, vizinhosDoPasso } from './mapaDeContexto.ts';

const secao = (key: string, parcial: Partial<CompletudeDaSecao>): CompletudeDaSecao => ({
  secao: key as CompletudeDaSecao['secao'],
  percentual: 0,
  preenchidos: 0,
  total: 4,
  essenciaisPreenchidos: 0,
  essenciaisTotal: 2,
  essenciaisCompletos: false,
  ...parcial,
});

const SECOES = [
  { key: 'empresa', letra: 'A', titulo: 'Empresa' },
  { key: 'produtos', letra: 'B', titulo: 'Produtos' },
];

describe('resumo do mapa de contexto', () => {
  it('cada seção vira um passo com marca de concluído e o Destino entra por último', () => {
    const completude = { geral: 40, secoes: [secao('empresa', { preenchidos: 2, essenciaisPreenchidos: 2, essenciaisCompletos: true })] };
    const resumo = resumoDoMapa(SECOES, completude, { percentual: 50, completo: false, resumo: '' });
    assert.deepEqual(resumo.passos.map((p) => [p.chave, p.marca, p.concluido]), [
      ['empresa', '✓', true],
      ['produtos', 'B', false],
      [PASSO_DO_DESTINO, '→', false],
    ]);
    assert.equal(resumo.passos[2]?.estado, 'comecada');
    assert.equal(resumo.geral, 40);
    assert.equal(resumo.concluidos, 1);
  });

  it('sem leitura do destino, a lista fica só com o catálogo', () => {
    assert.equal(resumoDoMapa(SECOES, { geral: 0, secoes: [] }, null).passos.length, 2);
  });

  it('vizinhos para a navegação de anterior e próxima', () => {
    const { passos } = resumoDoMapa(SECOES, { geral: 0, secoes: [] }, { percentual: 100, completo: true, resumo: '' });
    assert.deepEqual([vizinhosDoPasso(passos, 'empresa').anterior, vizinhosDoPasso(passos, 'empresa').proximo?.chave], [null, 'produtos']);
    assert.deepEqual([vizinhosDoPasso(passos, PASSO_DO_DESTINO).anterior?.chave, vizinhosDoPasso(passos, PASSO_DO_DESTINO).proximo], ['produtos', null]);
  });
});
