import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ESPECIFICACAO_DIMENSOES, ESPECIFICACAO_FATOS, montarDimensao, montarFato, nomeDoStaging,
} from './googleEspecificacao.ts';

const ctx = { organizationId: 'org', clientId: 'c', externalId: '123', currency: 'BRL', execucaoId: 'exec' };
const ddl = readFileSync('scripts/bq/21_google_ads.sql', 'utf8');
const manifesto = JSON.parse(readFileSync('scripts/bq/manifesto/google.json', 'utf8')) as { tabela: string; todoPeriodo?: boolean; data?: string }[];

function colunasDaTabelaNoDdl(tabela: string): string[] {
  const inicio = ddl.indexOf(`\`{{DATASET}}.${tabela}\` (`);
  assert.ok(inicio >= 0, `tabela ausente no DDL: ${tabela}`);
  const corpo = ddl.slice(inicio, ddl.indexOf('\n)', inicio));
  return corpo.split('\n').slice(1).map((linha) => linha.trim().split(/\s+/)[0]!);
}

test('fatos: chave dentro das colunas, tipos completos e DDL idêntico à configuração', () => {
  for (const espec of ESPECIFICACAO_FATOS) {
    const cfg = montarFato(espec);
    for (const coluna of cfg.chave) assert.ok(cfg.colunas.includes(coluna), `${cfg.fato}: chave ${coluna}`);
    assert.deepEqual(Object.keys(cfg.tipos), [...cfg.colunas]);
    assert.deepEqual(colunasDaTabelaNoDdl(cfg.fato), [...cfg.colunas]);
    assert.deepEqual(colunasDaTabelaNoDdl(cfg.staging), [...cfg.colunas]);
    assert.ok(ddl.includes(`\`{{DATASET}}.${cfg.fato.replace(/^fato_/, 'vw_')}\``));
  }
});

test('dimensões: staging e tabela no DDL seguem chave e atributos', () => {
  for (const espec of ESPECIFICACAO_DIMENSOES) {
    const cfg = montarDimensao(espec);
    const esperadas = [...cfg.chave, ...cfg.atributos];
    assert.deepEqual(colunasDaTabelaNoDdl(cfg.staging), [...esperadas, 'execucao_id', 'inserido_em']);
    assert.deepEqual(colunasDaTabelaNoDdl(cfg.dimensao), [...esperadas, 'valido_de', 'valido_ate', 'atual', 'hash_versao', 'execucao_id', 'carregado_em']);
  }
});

test('manifesto cobre toda tabela nova com o recorte certo', () => {
  for (const espec of ESPECIFICACAO_FATOS) {
    assert.equal(manifesto.find((entrada) => entrada.tabela === espec.tabela)?.data, 'data_dia', espec.tabela);
  }
  for (const espec of ESPECIFICACAO_DIMENSOES) {
    assert.equal(manifesto.find((entrada) => entrada.tabela === espec.tabela)?.todoPeriodo, true, espec.tabela);
  }
});

test('nome do staging', () => {
  assert.equal(nomeDoStaging('fato_google_anuncio_diario'), 'stg_google_anuncio_diario');
  assert.equal(nomeDoStaging('dim_google_campanha_scd2'), 'stg_google_campanha');
});

test('mapear devolve só colunas da tabela e chaves nunca nulas', () => {
  const termo = ESPECIFICACAO_FATOS.find((espec) => espec.tabela === 'fato_google_termo_pesquisa_diario')!;
  const cfg = montarFato(termo);
  const linha = cfg.mapear({ data_dia: '2026-01-02', external_campaign_id: '9', investimento: 1.5 }, ctx);
  assert.deepEqual(Object.keys(linha), [...cfg.colunas]);
  assert.equal(linha.organization_id, 'org');
  assert.equal(linha.ad_account_id, '123');
  assert.equal(linha.ad_group_id, '');
  assert.equal(linha.termo, '');
  assert.equal(linha.moeda, 'BRL');
  assert.equal(linha.impressoes, null);
  assert.equal(linha.investimento, 1.5);
});

test('dimensão: atributo ausente vira nulo e chave vazia', () => {
  const cfg = montarDimensao(ESPECIFICACAO_DIMENSOES[0]!);
  const linha = cfg.mapear({ external_campaign_id: '9', nome: 'X' }, ctx);
  assert.equal(linha.external_campaign_id, '9');
  assert.equal(linha.status, null);
  assert.equal(linha.ad_account_id, '123');
});
