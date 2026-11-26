import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../testes/ganchos.ts');
const { consultasDeDesempenho, RECORTES_POR_PLATAFORMA, PARAMETROS_DO_DESEMPENHO, sqlDoRecorte } = await import('./sqlDoDesempenho.ts');
const { normalizarLinha } = await import('./desempenhoBigQuery.ts');
const { janelaDeDesempenho } = await import('../domain/desempenho.ts');

const destino = { projeto: 'tria-platform', conjuntoDeDados: 'tria_dw' };

describe('SQL da medição de desempenho', () => {
  it('toda consulta filtra por organização e pelo cliente dono atual, com parâmetros nomeados', () => {
    for (const { nome, sql } of consultasDeDesempenho(destino, ['meta', 'google'])) {
      assert.match(sql, /organization_id = @organizacao AND cliente_atual_id = @cliente_id/, nome);
      const usados = [...sql.matchAll(/@([a-z_]+)/g)].map((m) => m[1]!);
      for (const p of usados) assert.ok((PARAMETROS_DO_DESEMPENHO as readonly string[]).includes(p), `${nome}: @${p}`);
      assert.ok(!/\$\{|undefined/.test(sql), nome);
    }
  });

  it('só meses fechados: o limite superior é o primeiro dia do mês corrente, exclusivo', () => {
    for (const { nome, sql } of consultasDeDesempenho(destino, ['meta', 'google'])) {
      assert.match(sql, /data_dia < @fim_serie/, nome);
      assert.ok(!/CURRENT_DATE|CURRENT_TIMESTAMP|BETWEEN/.test(sql), nome);
    }
    const janela = janelaDeDesempenho(new Date('2026-11-20T15:00:00Z'));
    assert.equal(janela.fimDaSerie, '2026-11-01');
  });

  it('total por plataforma e mês na série; campanha e recortes na janela de 3 meses', () => {
    const [total, campanha, ...recortes] = consultasDeDesempenho(destino, ['meta', 'google']);
    assert.match(total!.sql, /GROUP BY platform, periodo/);
    assert.match(total!.sql, /@inicio_serie/);
    assert.match(total!.sql, /`tria-platform\.tria_dw\.vw_ads_diario`/);
    assert.match(campanha!.sql, /@inicio_janela/);
    assert.match(campanha!.sql, /posicao <= 10/);
    assert.match(campanha!.sql, /PARTITION BY platform/);
    assert.equal(recortes.length, RECORTES_POR_PLATAFORMA.length);
    for (const r of recortes) {
      assert.match(r.sql, /posicao <= 8/);
      assert.match(r.sql, /@inicio_janela/);
    }
  });

  it('cada consulta declara os escopos (plataforma e recorte) que cobre', () => {
    const consultas = consultasDeDesempenho(destino, ['meta', 'google']);
    const escopos = Object.fromEntries(consultas.map((c) => [c.nome, c.escopos.map((e) => `${e.platform}:${e.recorte}`)]));
    assert.deepEqual(escopos['total'], ['meta:total', 'google:total']);
    assert.deepEqual(escopos['campanha'], ['meta:campanha', 'google:campanha']);
    assert.deepEqual(escopos['meta:regiao'], ['meta:regiao']);
    assert.deepEqual(escopos['google:dispositivo'], ['google:dispositivo']);
    assert.deepEqual(consultasDeDesempenho(destino, ['google'])[0]!.escopos, [{ platform: 'google', recorte: 'total' }]);
  });

  it('recortes só onde a tabela existe para a plataforma', () => {
    const soGoogle = consultasDeDesempenho(destino, ['google']).map((c) => c.nome);
    assert.deepEqual(soGoogle, ['total', 'campanha', 'google:dispositivo']);
    const soMeta = consultasDeDesempenho(destino, ['meta']).map((c) => c.nome);
    assert.deepEqual(soMeta, ['total', 'campanha', 'meta:idade_genero', 'meta:regiao', 'meta:posicionamento']);
  });

  it('sem coluna de dado pessoal e sem plataforma fora da lista', () => {
    for (const { sql } of consultasDeDesempenho(destino, ['meta', 'google', 'ga4'])) {
      assert.ok(!/email|telefone|cpf|nome_cliente|lead_id|ip_/i.test(sql));
      assert.ok(!/ga4/.test(sql));
    }
    assert.throws(() => consultasDeDesempenho(destino, ['ga4']));
  });

  it('recusa identificador perigoso', () => {
    assert.throws(() => consultasDeDesempenho({ projeto: 'P;', conjuntoDeDados: 'd' }, ['meta']));
    assert.throws(() => sqlDoRecorte(destino, { ...RECORTES_POR_PLATAFORMA[0]!, view: 'vw_x`; DROP' }));
    assert.throws(() => sqlDoRecorte(destino, { ...RECORTES_POR_PLATAFORMA[0]!, colunasDaChave: ['a); DROP'] }));
  });
});

describe('normalização das linhas do BigQuery', () => {
  const base = {
    platform: 'meta', periodo: { value: '2026-10-01' }, recorte: 'total', chave: null, rotulo: 'Total',
    investimento_centavos: '123456', impressoes: 10, cliques: 2, conversoes: 1.5, receita_centavos: null, moeda: 'BRL',
  };

  it('converte tipos, anula receita ausente e usa chave vazia no total', () => {
    const linha = normalizarLinha(base)!;
    assert.deepEqual([linha.periodo, linha.chave, linha.investimentoCentavos, linha.receitaCentavos, linha.moeda], ['2026-10-01', '', 123456, null, 'BRL']);
  });

  it('descarta recorte desconhecido e fatia sem chave; clampa negativos; moeda inválida vira XXX', () => {
    assert.equal(normalizarLinha({ ...base, recorte: 'cpf' }), null);
    assert.equal(normalizarLinha({ ...base, recorte: 'regiao', chave: '' }), null);
    assert.equal(normalizarLinha({ ...base, conversoes: 12.300000000000001 })!.conversoes, 12.3);
    const ajustada = normalizarLinha({ ...base, investimento_centavos: -5, moeda: 'real' })!;
    assert.equal(ajustada.investimentoCentavos, 0);
    assert.equal(ajustada.moeda, 'XXX');
  });
});
