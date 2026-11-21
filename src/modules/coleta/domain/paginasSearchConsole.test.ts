import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

type No = { name: string; parameters: { jsCode?: string } };
type Modelo = { nodes: No[] };
type Saida = { linhas: Record<string, unknown>[]; falhas: { causa: string; detalhe: string | null }[] };

const modelo = JSON.parse(readFileSync('n8n/workflows/coletores/coletor-searchconsole.json', 'utf8')) as Modelo;
const codigo = (nome: string) => String(modelo.nodes.find((no) => no.name === nome)!.parameters.jsCode);

const TABELAS = ['padrao', 'consulta_pagina', 'pagina', 'pais_dispositivo', 'aparencia', 'tipo'];
const ok = (rows: unknown[]) => ({ statusCode: 200, body: { rows } });

function rodar(porTabela: Record<string, unknown[]>, modo = 'completo'): Saida {
  const montar = new Function('$json', codigo('Montar requisição')) as (entrada: unknown) => { json: unknown }[];
  const contexto = montar({ fonte: { externalId: 'sc-domain:exemplo.com.br' }, janela: { start: '2026-11-01', end: '2026-11-02' }, modo })[0]!.json;
  const $ = (nome: string) => ({
    first: () => ({ json: nome === 'Montar requisição' ? contexto : { respostas: porTabela[nome.replace('Fechar ', '')] ?? [] } }),
  });
  const normalizar = new Function('$', codigo('Normalizar')) as (referencia: typeof $) => { json: Saida }[];
  return normalizar($)[0]!.json;
}

const linhaDePagina = (pagina: string, cliques: number, impressoes: number, posicao: number) => ({
  keys: ['2026-11-01', pagina],
  clicks: cliques,
  impressions: impressoes,
  ctr: cliques / impressoes,
  position: posicao,
});

describe('coletor do Search Console: páginas sem dado pessoal na URL', () => {
  it('remove query string e âncora, mantendo esquema, host e caminho', () => {
    const saida = rodar({
      pagina: [ok([
        linhaDePagina('https://exemplo.com.br/redefinir?token=abc123&email=maria@x.com', 1, 10, 3),
        linhaDePagina('https://exemplo.com.br/produto#reviews', 2, 20, 5),
      ])],
    });
    const paginas = saida.linhas.filter((linha) => linha._tabela === 'pagina').map((linha) => linha.pagina);
    assert.deepEqual(paginas.sort(), ['https://exemplo.com.br/produto', 'https://exemplo.com.br/redefinir']);
    const serializado = JSON.stringify(saida);
    for (const proibido of ['abc123', 'maria@x.com', '?', '#reviews']) assert.ok(!serializado.includes(proibido), `vazou: ${proibido}`);
  });

  it('páginas que só diferiam pela query viram uma linha, com somas e posição ponderada', () => {
    const saida = rodar({
      pagina: [ok([
        linhaDePagina('https://exemplo.com.br/loja?utm=a', 1, 10, 2),
        linhaDePagina('https://exemplo.com.br/loja?utm=b', 3, 30, 6),
      ])],
    });
    const linhas = saida.linhas.filter((linha) => linha._tabela === 'pagina');
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]!.pagina, 'https://exemplo.com.br/loja');
    assert.equal(linhas[0]!.cliques, 4);
    assert.equal(linhas[0]!.impressoes, 40);
    assert.equal(linhas[0]!.ctr, 0.1);
    assert.equal(linhas[0]!.posicao_media, 5);
  });

  it('páginas em consulta_pagina também ficam sem query', () => {
    const linha = { keys: ['2026-11-01', 'tênis', 'https://exemplo.com.br/a?x=1'], clicks: 1, impressions: 4, ctr: 0.25, position: 1 };
    const saida = rodar({ consulta_pagina: [ok([linha])] });
    const [resultado] = saida.linhas.filter((item) => item._tabela === 'consulta_pagina');
    assert.equal(resultado!.pagina, 'https://exemplo.com.br/a');
    assert.equal(resultado!.consulta, 'tênis');
  });

  it('tabela que bate no teto de 80 páginas cheias marca a coleta como incompleta', () => {
    const cheia = ok(Array.from({ length: 25_000 }, (_, indice) => linhaDePagina(`https://exemplo.com.br/p${indice}`, 1, 2, 1)));
    const saida = rodar({ pagina: Array.from({ length: 80 }, () => cheia) });
    assert.ok(saida.falhas.some((falha) => falha.causa === 'coleta_incompleta' && /pagina/.test(falha.detalhe ?? '')));
  });
});

describe('coletor do Search Console: tipos de busca além de web', () => {
  const linhaDoTipo = (dia: string, impressoes: number, cliques = 0) => ({ keys: [dia], clicks: cliques, impressions: impressoes, ctr: 0, position: impressoes > 0 ? 4 : 0 });
  const respostaDoTipo = (tipo: string, rows: unknown[]) => ({ statusCode: 200, tipo, body: { rows } });

  it('descarta linhas com zero impressões e identifica o tipo na linha', () => {
    const saida = rodar({
      tipo: [respostaDoTipo('image', [linhaDoTipo('2026-11-01', 5, 1), linhaDoTipo('2026-11-02', 0)]), respostaDoTipo('video', [linhaDoTipo('2026-11-01', 0)])],
    });
    const linhas = saida.linhas.filter((linha) => linha._tabela === 'tipo');
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]!.tipo, 'image');
    assert.equal(linhas[0]!.metricDate, '2026-11-01');
    assert.equal(linhas[0]!.impressoes, 5);
  });

  it('só zeros nos tipos não vira falha nem linhas', () => {
    const saida = rodar({ pagina: [ok([linhaDePagina('https://exemplo.com.br/a', 1, 2, 1)])], tipo: [respostaDoTipo('news', [linhaDoTipo('2026-11-01', 0)])] });
    assert.equal(saida.linhas.filter((linha) => linha._tabela === 'tipo').length, 0);
    assert.equal(saida.falhas.length, 0);
  });

  it('resposta cheia no limite de linhas marca coleta incompleta', () => {
    const cheia = respostaDoTipo('discover', Array.from({ length: 25_000 }, () => linhaDoTipo('2026-11-01', 3)));
    const saida = rodar({ tipo: [cheia] });
    assert.ok(saida.falhas.some((falha) => falha.causa === 'coleta_incompleta' && /tipo/.test(falha.detalhe ?? '')));
  });

  it('o corpo de cada tipo usa dimensions [date] e a lista de tipos', () => {
    const montar = new Function('$json', codigo('Montar requisição')) as (entrada: unknown) => { json: { consultas: Record<string, { corpo: Record<string, unknown>; tipos?: string[] }> } }[];
    const { consultas } = montar({ fonte: { externalId: 'sc-domain:x' }, janela: { start: '2026-11-01', end: '2026-11-02' }, modo: 'completo' })[0]!.json;
    assert.deepEqual(consultas.tipo!.corpo.dimensions, ['date']);
    assert.deepEqual(consultas.tipo!.tipos, ['image', 'video', 'news', 'discover', 'googleNews']);
  });
});
