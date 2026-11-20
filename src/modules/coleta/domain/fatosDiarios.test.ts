import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  chaveDoRecorte,
  colunasDoRecorte,
  linhaDoRecorte,
  numeroDaMetrica,
  textoDaDimensao,
  tiposDoRecorte,
  VALOR_AUSENTE,
  type RecorteDeFato,
} from './fatosDiarios.ts';
import { RECORTES_GA4 } from './recortesGa4.ts';
import { RECORTES_SEARCH_CONSOLE } from './recortesSearchConsole.ts';

type No = { name: string; parameters: Record<string, unknown> };
type Modelo = { nodes: No[] };
type Item = { json: Record<string, any> };
type Funcao = (...args: unknown[]) => Item[];

const carregar = (arquivo: string): Modelo => JSON.parse(readFileSync(`n8n/workflows/coletores/${arquivo}`, 'utf8')) as Modelo;
const codigo = (modelo: Modelo, nome: string): string => modelo.nodes.find((no) => no.name === nome)!.parameters.jsCode as string;
const compilar = (fonte: string, ...parametros: string[]): Funcao => new Function(...parametros, fonte) as Funcao;

const CONTEXTO = { organizationId: 'org', fonteId: 'f1', execucaoId: 'ex', inseridoEm: '2026-01-01T00:00:00Z' };

describe('fatos diários por recorte', () => {
  const todos: readonly RecorteDeFato[] = [...RECORTES_GA4, ...RECORTES_SEARCH_CONSOLE];

  it('nomes de tabela são únicos e a chave cobre dimensões e fonte', () => {
    assert.equal(new Set(todos.map((r) => r.fato)).size, todos.length);
    for (const recorte of todos) {
      const colunas = colunasDoRecorte(recorte);
      assert.equal(new Set(colunas).size, colunas.length);
      for (const coluna of chaveDoRecorte(recorte)) assert.ok(colunas.includes(coluna));
      assert.deepEqual(Object.keys(tiposDoRecorte(recorte)).sort(), [...colunas].sort());
      assert.ok(recorte.dimensoes.length + 1 <= 9);
    }
  });

  it('dimensão ausente vira (not set) e métrica inteira é arredondada', () => {
    assert.equal(textoDaDimensao(''), VALOR_AUSENTE);
    assert.equal(textoDaDimensao(null), VALOR_AUSENTE);
    assert.equal(textoDaDimensao('x'.repeat(5000)).length, 2048);
    assert.equal(numeroDaMetrica('3.6', 'INT64'), 4);
    assert.equal(numeroDaMetrica('0.12345678', 'NUMERIC'), 0.123457);
    assert.equal(numeroDaMetrica('NaN', 'NUMERIC'), 0);
  });

  it('linha mapeada traz exatamente as colunas do fato', () => {
    for (const recorte of todos) {
      const linha = linhaDoRecorte(recorte, { metricDate: '2026-01-01' }, CONTEXTO);
      assert.deepEqual(Object.keys(linha).sort(), [...colunasDoRecorte(recorte)].sort());
      assert.equal(linha[recorte.colunaDaFonte], 'f1');
    }
  });
});

describe('coletor GA4', () => {
  const modelo = carregar('coletor-ga4.json');
  const entrada = { fonte: { externalId: 'properties/123' }, janela: { start: '2026-01-01', end: '2026-01-28' }, modo: 'completo' };
  const montados = compilar(codigo(modelo, 'Montar requisição'), '$json')(entrada);

  it('um pedido por recorte, até 9 dimensões, mesmas colunas do TypeScript', () => {
    assert.equal(montados.length, RECORTES_GA4.length + 1);
    for (const { json } of montados) {
      assert.ok(json.corpo.dimensions.length <= 9);
      assert.ok(json.corpo.metrics.length <= 10);
      assert.match(json.url, /properties\/123:runReport$/);
    }
    for (const recorte of RECORTES_GA4) {
      const pedido = montados.find((item) => item.json.recorte.tabela === recorte.tabela)!.json.recorte;
      const campos = [...pedido.dimensoes, ...pedido.metricas].map(([, campo]: [string, string]) => campo).filter((c: string) => c !== 'metricDate');
      assert.deepEqual(campos.sort(), [...recorte.dimensoes, ...Object.keys(recorte.metricas)].sort());
    }
  });

  it('normaliza cada resposta pelo cabeçalho e marca recorte opcional recusado como coleta_incompleta', () => {
    const normalizar = compilar(codigo(modelo, 'Normalizar'), '$', '$input');
    const respostaDe = (tabela: string, valores: string[], metricas: string[]) => {
      const { recorte } = montados.find((item) => item.json.recorte.tabela === tabela)!.json;
      return {
        json: {
          statusCode: 200,
          body: {
            dimensionHeaders: recorte.dimensoes.map(([nome]: string[]) => ({ name: nome })),
            rows: [{ dimensionValues: valores.map((value) => ({ value })), metricValues: metricas.map((value) => ({ value })) }],
          },
        },
      };
    };
    const itemRecusado: Item = {
      json: { statusCode: 400, body: { error: { code: 400, message: 'Field itemName is not a valid dimension' } } },
    };
    const entradas = [
      respostaDe('padrao', ['20260105', 'Organic Search'], ['10', '8', '5', '1', '99.5']),
      respostaDe('evento', ['20260105', 'purchase'], ['4', '3', '120.5', '4']),
      itemRecusado,
    ];
    const saida = normalizar((nome: string) => ({ all: () => montados, first: () => montados[0] }), { all: () => entradas })[0]!.json;
    assert.equal(saida.falhas.length, 1);
    assert.equal(saida.falhas[0].causa, 'coleta_incompleta');
    assert.match(saida.falhas[0].detalhe, /^item: Field itemName/);
    assert.equal(saida.linhas.length, 2);
    assert.equal(saida.linhas[0].canal, 'Organic Search');
    assert.equal(saida.linhas[0]._tabela, undefined);
    assert.equal(saida.linhas[0].metricDate, '2026-01-05');
    assert.equal(saida.linhas[1]._tabela, 'evento');
    assert.equal(saida.linhas[1].valor, 120.5);
  });

  it('recusa de recorte obrigatório falha a coleta', () => {
    const normalizar = compilar(codigo(modelo, 'Normalizar'), '$', '$input');
    const entradas: Item[] = [{ json: { statusCode: 403, body: { error: { code: 403, message: 'denied' } } } }];
    const saida = normalizar(() => ({ all: () => montados }), { all: () => entradas })[0]!.json;
    assert.equal(saida.falhas[0].causa, 'reauth_pending');
  });
});

describe('coletor Search Console', () => {
  const modelo = carregar('coletor-searchconsole.json');
  const entrada = { fonte: { externalId: 'sc-domain:exemplo.com.br' }, janela: { start: '2026-01-01', end: '2026-01-28' }, modo: 'completo' };
  const montado = compilar(codigo(modelo, 'Montar requisição'), '$json')(entrada)[0]!.json;

  it('consultas pedem dataState final, paginam por startRow e casam com o TypeScript', () => {
    for (const consulta of Object.values<Record<string, any>>(montado.consultas)) {
      assert.equal(consulta.corpo.dataState, 'final');
      assert.equal(consulta.corpo.rowLimit, 25000);
      assert.equal(consulta.corpo.startRow, 0);
    }
    for (const recorte of RECORTES_SEARCH_CONSOLE) {
      const consulta = montado.consultas[recorte.tabela];
      const campos = [...consulta.dimensoes.map(([, campo]: [string, string]) => campo).filter((c: string) => c !== 'metricDate'), ...consulta.metricas];
      assert.deepEqual(campos.sort(), [...recorte.dimensoes, ...Object.keys(recorte.metricas)].sort());
      assert.ok(modelo.nodes.some((no) => no.name === `Chamar ${recorte.tabela}`));
    }
  });

  it('normaliza as páginas de cada consulta e marca recusa do recorte opcional como coleta_incompleta', () => {
    const normalizar = compilar(codigo(modelo, 'Normalizar'), '$');
    const pagina = (keys: string[]) => ({ statusCode: 200, body: { rows: [{ keys, clicks: 2, impressions: 10, ctr: 0.2, position: 3.5 }] } });
    const respostasPorTabela: Record<string, Record<string, unknown>[]> = {
      padrao: [pagina(['2026-01-05', 'MOBILE'])],
      consulta_pagina: [pagina(['2026-01-05', 'tênis', 'https://exemplo.com.br/a']), pagina(['2026-01-06', 'bota', 'https://exemplo.com.br/b'])],
      pagina: [],
      pais_dispositivo: [pagina(['2026-01-05', 'bra', 'DESKTOP'])],
      aparencia: [{ statusCode: 400, body: { error: { code: 400, message: 'invalid' } } }],
    };
    const referencia = (nome: string) => {
      if (nome === 'Montar requisição') return { first: () => ({ json: montado }) };
      const tabela = nome.replace('Fechar ', '');
      return { first: () => ({ json: { respostas: respostasPorTabela[tabela] } }) };
    };
    const saida = normalizar(referencia)[0]!.json;
    assert.deepEqual(saida.falhas, [{ causa: 'coleta_incompleta', detalhe: 'aparencia: invalid' }]);
    assert.equal(saida.linhas.length, 4);
    assert.equal(saida.linhas[0].device, 'MOBILE');
    assert.equal(saida.linhas[0].clicks, 2);
    assert.equal(saida.linhas[1]._tabela, 'consulta_pagina');
    assert.equal(saida.linhas[1].consulta, 'tênis');
    assert.equal(saida.linhas[3].pais, 'bra');
    assert.equal(saida.linhas[3].posicao_media, 3.5);
  });

  it('recusa de recorte obrigatório falha a coleta', () => {
    const normalizar = compilar(codigo(modelo, 'Normalizar'), '$');
    const referencia = (nome: string) => {
      if (nome === 'Montar requisição') return { first: () => ({ json: montado }) };
      const respostas = nome === 'Fechar pagina' ? [{ statusCode: 403, body: { error: { code: 403, message: 'denied' } } }] : [];
      return { first: () => ({ json: { respostas } }) };
    };
    assert.equal(normalizar(referencia)[0]!.json.falhas[0].causa, 'reauth_pending');
  });
});
