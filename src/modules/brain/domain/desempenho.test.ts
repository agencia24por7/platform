import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../testes/ganchos.ts');
const d = await import('./desempenho.ts');

const linha = {
  platform: 'meta', periodo: '2026-10-01', recorte: 'total' as const, chave: '', rotulo: 'Total', investimentoCentavos: 1_234_567,
  impressoes: 1_000_000, cliques: 12_345, conversoes: 123.5, receitaCentavos: 4_567_890, moeda: 'BRL',
};

describe('janela de desempenho', () => {
  it('nunca inclui o mês corrente e cobre 6 meses fechados', () => {
    assert.deepEqual(d.janelaDeDesempenho(new Date('2026-11-20T15:00:00Z')), {
      inicioDaSerie: '2026-05-01', fimDaSerie: '2026-11-01', inicioDaJanela: '2026-08-01',
    });
  });

  it('usa o fuso de São Paulo na virada do mês e do ano', () => {
    assert.equal(d.janelaDeDesempenho(new Date('2026-12-05T01:00:00Z')).fimDaSerie, '2026-12-01');
    assert.deepEqual(d.janelaDeDesempenho(new Date('2027-01-15T12:00:00Z')), {
      inicioDaSerie: '2026-07-01', fimDaSerie: '2027-01-01', inicioDaJanela: '2026-10-01',
    });
  });

  it('um mês só fecha a partir do dia 4 do mês seguinte (carência de 3 dias)', () => {
    const fim = (iso: string) => d.janelaDeDesempenho(new Date(iso)).fimDaSerie;
    assert.equal(d.DIAS_DE_CARENCIA, 3);
    assert.equal(fim('2026-11-03T15:00:00Z'), '2026-10-01');
    assert.equal(fim('2026-11-04T15:00:00Z'), '2026-11-01');
    assert.equal(fim('2026-11-01T15:00:00Z'), '2026-10-01');
    assert.equal(fim('2027-01-03T15:00:00Z'), '2026-12-01');
    assert.equal(fim('2027-01-04T15:00:00Z'), '2027-01-01');
    assert.deepEqual(d.janelaDeDesempenho(new Date('2027-01-02T15:00:00Z')), {
      inicioDaSerie: '2026-06-01', fimDaSerie: '2026-12-01', inicioDaJanela: '2026-09-01',
    });
  });

  it('a carência usa o dia de São Paulo, não o de UTC', () => {
    assert.equal(d.janelaDeDesempenho(new Date('2026-11-04T01:00:00Z')).fimDaSerie, '2026-10-01');
    assert.equal(d.janelaDeDesempenho(new Date('2026-11-04T03:00:00Z')).fimDaSerie, '2026-11-01');
  });

  it('soma meses atravessando o ano', () => {
    assert.equal(d.somarMeses('2026-01-01', -2), '2025-11-01');
    assert.equal(d.somarMeses('2026-11-01', 3), '2027-02-01');
    assert.equal(d.ultimoDiaDoMes('2026-02-01'), '2026-02-28');
    assert.equal(d.ultimoDiaDaJanela('2026-08-01'), '2026-10-31');
  });
});

describe('derivados e formatação', () => {
  it('calcula CTR, custo por clique, custo por conversão e ROAS em código', () => {
    const r = d.derivadosDe(linha);
    assert.equal(r.ctr?.toFixed(4), '1.2345');
    assert.equal(r.custoPorCliqueCentavos, 100);
    assert.equal(r.custoPorConversaoCentavos, 9996);
    assert.equal(r.roas?.toFixed(2), '3.70');
  });

  it('divisão por zero vira n/d no texto', () => {
    const zerada = { ...linha, impressoes: 0, cliques: 0, conversoes: 0, receitaCentavos: null };
    const d0 = d.derivadosDe(zerada);
    assert.deepEqual([d0.ctr, d0.custoPorCliqueCentavos, d0.custoPorConversaoCentavos, d0.roas], [null, null, null, null]);
    const texto = d.resumoDeMetricas(zerada);
    assert.match(texto, /CTR n\/d/);
    assert.match(texto, /custo por clique n\/d/);
    assert.match(texto, /custo por conversão n\/d/);
    assert.match(texto, /ROAS n\/d/);
    assert.match(texto, /receita n\/d/);
    assert.ok(!/NaN|Infinity/.test(texto));
  });

  it('formata dinheiro a partir de centavos com a moeda explícita', () => {
    assert.equal(d.formatarDinheiro(1_234_567, 'BRL'), 'R$ 12.345,67');
    assert.equal(d.formatarDinheiro(5, 'BRL'), 'R$ 0,05');
    assert.equal(d.formatarDinheiro(100_000_000, 'USD'), 'USD 1.000.000,00');
    assert.match(d.formatarDinheiro(100, 'XXX'), /moedas mistas/);
  });

  it('resumo determinístico com todos os números', () => {
    assert.equal(
      d.resumoDeMetricas(linha),
      'investimento R$ 12.345,67; impressões 1.000.000; cliques 12.345; conversões 123,5; receita R$ 45.678,90; CTR 1,23%; custo por clique R$ 1,00; custo por conversão R$ 99,96; ROAS 3,70x',
    );
    assert.equal(d.resumoDeMetricas(linha), d.resumoDeMetricas({ ...linha }));
  });

  it('conversões sem casas inúteis', () => {
    assert.equal(d.formatarConversoes(50), '50');
    assert.equal(d.formatarConversoes(2.5), '2,5');
    assert.equal(d.formatarConversoes(2.05), '2,05');
  });
});
