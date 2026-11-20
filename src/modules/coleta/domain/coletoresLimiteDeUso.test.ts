import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

type No = { name: string; type: string; parameters: Record<string, unknown> & { jsCode?: string; options?: Record<string, unknown> } };
type Modelo = { nodes: No[] };
type Item = { json: Record<string, unknown> };
type Saida = { linhas: Record<string, unknown>[]; falhas: { causa: string; detalhe: string | null }[]; avisos?: { tipo: string }[] };

const carregar = (arquivo: string): Modelo => JSON.parse(readFileSync(`n8n/workflows/${arquivo}`, 'utf8')) as Modelo;

function executar(modelo: Modelo, nome: string, entrada: Item[], nos: Record<string, Item[]>): Item[] {
  const codigo = modelo.nodes.find((candidato) => candidato.name === nome)!.parameters.jsCode!;
  const referenciar = (outro: string) => ({ all: () => nos[outro]!, first: () => nos[outro]![0]! });
  const corpo = new Function('$input', '$json', '$', codigo) as (...argumentos: unknown[]) => Item[];
  return corpo({ all: () => entrada, first: () => entrada[0] }, entrada[0]?.json, referenciar);
}

const ok = (corpo: unknown): Item => ({ json: { statusCode: 200, body: corpo } });
const recusa = (statusCode: number, erro: Record<string, unknown>): Item => ({ json: { statusCode, body: { error: erro } } });
const saida = (itens: Item[]): Saida => itens[0]!.json as unknown as Saida;

describe('coletor Google Ads: só a consulta de campanha é obrigatória', () => {
  const modelo = carregar('coletores/coletor-google-ads.json');
  const fonte = { externalId: '123-456-7890', currency: 'BRL', comDimensoes: false };
  const pedidos = executar(modelo, 'Montar requisição', [{ json: { fonte, janela: { start: '2026-11-01', end: '2026-11-03' }, modo: 'incremental' } }], {});
  const campanha = { results: [{ campaign: { id: '1', name: 'C' }, segments: { date: '2026-11-01' }, metrics: { costMicros: '1000000', impressions: '10', clicks: '1' } }] };

  it('não limita linhas e respeita comDimensoes = false', () => {
    for (const pedido of pedidos) assert.ok(!String((pedido.json.corpo as { query: string }).query).includes('LIMIT'));
    assert.ok(pedidos.every((pedido) => String(pedido.json.tabela).startsWith('fato_')));
    assert.equal(pedidos.filter((pedido) => pedido.json.obrigatoria === true).length, 1);
  });

  const responder = (recusada: string, resposta: Item) => pedidos.map((pedido) => {
    if (pedido.json.tabela === recusada) return resposta;
    return pedido.json.tabela === 'fato_google_campanha_diario' ? ok([campanha]) : ok([{ results: [] }]);
  });

  it('consulta opcional recusada vira coleta_incompleta e o resto é gravado', () => {
    const resultado = saida(executar(modelo, 'Normalizar', responder('fato_google_geo_diario', recusa(400, { message: 'campo não suportado' })), { 'Montar requisição': pedidos }));
    assert.deepEqual(resultado.falhas.map((falha) => falha.causa), ['coleta_incompleta']);
    assert.ok(resultado.falhas[0]!.detalhe!.startsWith('fato_google_geo_diario: '));
    assert.ok(resultado.linhas.some((linha) => linha._tabela === 'fato_google_campanha_diario'));
  });

  it('recusa da campanha é fatal', () => {
    const resultado = saida(executar(modelo, 'Normalizar', responder('fato_google_campanha_diario', recusa(400, { message: 'inválida' })), { 'Montar requisição': pedidos }));
    assert.equal(resultado.falhas[0]!.causa, 'api_recusou');
  });

  it('cota diária esgotada vira limite_de_uso marcado como cota_diaria', () => {
    const erro = { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Number of operations for basic access exceeded' };
    const resultado = saida(executar(modelo, 'Normalizar', responder('fato_google_rede_diario', recusa(429, erro)), { 'Montar requisição': pedidos }));
    assert.equal(resultado.falhas[0]!.causa, 'limite_de_uso');
    assert.ok(resultado.falhas[0]!.detalhe!.startsWith('cota_diaria: '));
  });

  it('API desligada no projeto continua api_recusou, não limite', () => {
    const erro = { code: 403, message: 'SERVICE_DISABLED' };
    const resultado = saida(executar(modelo, 'Normalizar', responder('fato_google_campanha_diario', recusa(403, erro)), { 'Montar requisição': pedidos }));
    assert.equal(resultado.falhas[0]!.causa, 'api_recusou');
  });
});

describe('coletor YouTube: receita é opcional', () => {
  const modelo = carregar('coletores/coletor-youtube.json');
  const entrada: Item[] = [{ json: { fonte: { externalId: 'UC1', comDimensoes: false }, janela: { start: '2026-11-01', end: '2026-11-01' } } }];
  const etapa1 = executar(modelo, 'Montar requisição', entrada, {});

  it('a consulta essencial do canal não pede estimatedRevenue', () => {
    const canal = etapa1.find((item) => item.json.rotulo === 'canal_dia')!;
    assert.ok(!String(canal.json.url).includes('estimatedRevenue'));
    assert.ok(etapa1.some((item) => item.json.rotulo === 'receita'));
  });

  it('403 na receita não zera o canal: grava com receita nula e avisa', () => {
    const respostas = etapa1.map((item) => {
      if (item.json.rotulo === 'receita') return recusa(403, { message: 'Forbidden' });
      if (item.json.rotulo === 'canal_dia') return ok({ columnHeaders: [{ name: 'day' }, { name: 'views' }], rows: [['2026-11-01', 3]] });
      return ok({ columnHeaders: [], rows: [] });
    });
    const etapa2 = executar(modelo, 'Planejar etapa 2', respostas, { 'Montar requisição': etapa1, Entrada: entrada });
    assert.ok(etapa2.every((item) => item.json.rotulo !== 'playlists'));
    const resultado = saida(executar(modelo, 'Normalizar', [], {
      'Montar requisição': etapa1,
      'Chamar API (analytics)': respostas,
      'Planejar etapa 2': etapa2,
    }));
    assert.deepEqual(resultado.falhas, []);
    const canal = resultado.linhas.find((linha) => linha._tabela === undefined)!;
    assert.equal(canal.estimatedRevenue, null);
    assert.ok(resultado.avisos!.some((aviso) => aviso.tipo === 'receita_indisponivel'));
  });
});

describe('coletor GTM respeita 0,25 QPS', () => {
  it('todo nó HTTP tem batching de 1 item a cada 4,5 s ou mais', () => {
    const modelo = carregar('coletores/coletor-gtm.json');
    for (const no of modelo.nodes.filter((candidato) => candidato.type === 'n8n-nodes-base.httpRequest')) {
      const lote = (no.parameters.options as { batching?: { batch: { batchSize: number; batchInterval: number } } }).batching!.batch;
      assert.equal(lote.batchSize, 1, no.name);
      assert.ok(lote.batchInterval >= 4500, no.name);
    }
  });
});

describe('orquestrador incremental', () => {
  const modelo = carregar('coleta-orquestrador.json');
  const no = (nome: string) => modelo.nodes.find((candidato) => candidato.name === nome)!;

  it('pede fontes e abre coletas em modo incremental, com chave por execução', () => {
    assert.ok(String(no('Ler fontes elegíveis').parameters.url).includes('modo=incremental'));
    const corpo = String(no('Abrir execução').parameters.jsonBody);
    assert.ok(corpo.includes("mode: 'incremental'"));
    assert.ok(corpo.includes(':incremental:${$execution.id}'));
  });

  it('nenhum coletor da rotina tem ramo de amostra', () => {
    for (const arquivo of ['coletor-google-ads.json', 'coletor-ga4.json', 'coletor-searchconsole.json']) {
      assert.ok(!readFileSync(`n8n/workflows/coletores/${arquivo}`, 'utf8').includes("'amostra'"), arquivo);
    }
  });
});
