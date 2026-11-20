import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

type No = { name: string; parameters: { jsCode?: string } };
type Modelo = { nodes: No[] };
type Item = { json: Record<string, unknown> };
type Saida = { linhas: Record<string, unknown>[]; falhas: { causa: string }[]; requests: number };

const carregar = (arquivo: string): Modelo => JSON.parse(readFileSync(`n8n/workflows/coletores/${arquivo}`, 'utf8')) as Modelo;

function executar(modelo: Modelo, nome: string, entrada: Item[], nos: Record<string, Item[]>): Item[] {
  const codigo = modelo.nodes.find((candidato) => candidato.name === nome)!.parameters.jsCode!;
  const referenciar = (outro: string) => ({ all: () => nos[outro]!, first: () => nos[outro]![0]! });
  const corpo = new Function('$input', '$json', '$', codigo) as (...argumentos: unknown[]) => Item[];
  return corpo({ all: () => entrada, first: () => entrada[0] }, entrada[0]?.json, referenciar);
}

const ok = (corpo: unknown): Item => ({ json: { statusCode: 200, body: corpo } });
const recusada = (statusCode: number): Item => ({ json: { statusCode, body: { error: { code: statusCode, message: 'negado' } } } });
const saida = (itens: Item[]): Saida => itens[0]!.json as unknown as Saida;
const tabelas = (linhas: Saida['linhas']): string[] => [...new Set(linhas.map((linha) => String(linha._tabela ?? 'padrao')))].sort();

describe('coletor YouTube', () => {
  const modelo = carregar('coletor-youtube.json');
  const janela = { start: '2026-11-01', end: '2026-11-03' };
  const entrada: Item[] = [{ json: { fonte: { externalId: ' UC123 ' }, janela, modo: 'diario' } }];

  it('planeja canal, recortes e um pedido por dia para país e audiência', () => {
    const itens = executar(modelo, 'Montar requisição', entrada, {});
    const rotulos = itens.map((item) => item.json.rotulo);
    assert.equal(rotulos.filter((rotulo) => rotulo === 'pais').length, 3);
    assert.equal(rotulos.filter((rotulo) => rotulo === 'audiencia').length, 3);
    for (const rotulo of ['canal_dia', 'origem_trafego', 'dispositivo', 'local_reproducao', 'top_videos']) assert.ok(rotulos.includes(rotulo), rotulo);
    assert.ok(String(itens[0]!.json.url).includes('channel%3D%3DUC123'));
  });

  it('limita os pedidos por dia a 31 dias', () => {
    const longa = [{ json: { fonte: { externalId: 'UC1' }, janela: { start: '2026-01-01', end: '2026-11-03' } } }];
    const itens = executar(modelo, 'Montar requisição', longa, {});
    assert.equal(itens.filter((item) => item.json.rotulo === 'pais').length, 31);
  });

  const etapa1 = executar(modelo, 'Montar requisição', entrada, {});
  const colunasDoRecorte = (nome: string) => [{ name: 'day' }, { name: nome }, { name: 'views' }, { name: 'estimatedMinutesWatched' }];
  const respostas1 = etapa1.map((item): Item => {
    switch (item.json.rotulo) {
      case 'canal_dia':
        return ok({ columnHeaders: [{ name: 'day' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'subscribersGained' }, { name: 'subscribersLost' }, { name: 'estimatedRevenue' }], rows: [['2026-11-01', 10, 5, 1, 0, 0.5]] });
      case 'origem_trafego':
        return ok({ columnHeaders: colunasDoRecorte('insightTrafficSourceType'), rows: [['2026-11-01', 'YT_SEARCH', 7, 3]] });
      case 'top_videos':
        return ok({ columnHeaders: [{ name: 'video' }, { name: 'views' }], rows: [['v1', 9], ['v2', 4]] });
      case 'pais':
        return ok({ columnHeaders: [{ name: 'country' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }], rows: [['BR', 5, 2]] });
      case 'audiencia':
        return ok({ columnHeaders: [{ name: 'ageGroup' }, { name: 'gender' }, { name: 'viewerPercentage' }], rows: [['age25-34', 'female', 12.5]] });
      default:
        return ok({ columnHeaders: [], rows: [] });
    }
  });

  it('planeja a etapa 2 a partir dos vídeos mais vistos', () => {
    const etapa2 = executar(modelo, 'Planejar etapa 2', respostas1, {
      'Montar requisição': etapa1,
      Entrada: entrada,
    });
    const rotulos = etapa2.map((item) => item.json.rotulo);
    assert.deepEqual(rotulos, ['video_dia', 'video_dia', 'videos', 'playlists']);
    assert.ok(String(etapa2[2]!.json.url).includes('v1%2Cv2'));
  });

  it('normaliza todas as tabelas e converte a duração ISO 8601', () => {
    const etapa2 = executar(modelo, 'Planejar etapa 2', respostas1, { 'Montar requisição': etapa1, Entrada: entrada });
    const respostas2 = etapa2.map((item): Item => {
      switch (item.json.rotulo) {
        case 'video_dia':
          return ok({ columnHeaders: [{ name: 'day' }, { name: 'views' }, { name: 'likes' }], rows: [['2026-11-02', 3, 1]] });
        case 'videos':
          return ok({ items: [{ id: 'v1', snippet: { title: 'Titulo', publishedAt: '2026-10-01T10:00:00Z', categoryId: '22' }, contentDetails: { duration: 'PT1H2M3S' }, status: { privacyStatus: 'public' } }] });
        default:
          return ok({ items: [{ id: 'p1', snippet: { title: 'Lista' }, status: { privacyStatus: 'private' }, contentDetails: { itemCount: 4 } }] });
      }
    });
    const resultado = saida(executar(modelo, 'Normalizar', respostas2, {
      'Montar requisição': etapa1,
      'Chamar API (analytics)': respostas1,
      'Planejar etapa 2': etapa2,
    }));
    assert.deepEqual(resultado.falhas, []);
    assert.deepEqual(tabelas(resultado.linhas), ['audiencia', 'dim_playlist', 'dim_video', 'origem_trafego', 'padrao', 'pais', 'video_diario']);
    const video = resultado.linhas.find((linha) => linha._tabela === 'dim_video')!;
    assert.equal(video.duracaoSegundos, 3723);
    assert.equal(resultado.linhas.filter((linha) => linha._tabela === 'video_diario').length, 2);
    assert.equal(resultado.requests, respostas1.length + respostas2.length);
  });

  it('falha do canal por dia vira reauth_pending e recorte recusado é ignorado', () => {
    const comNegado = respostas1.map((resposta, indice) => (etapa1[indice]!.json.rotulo === 'canal_dia' ? recusada(403) : resposta));
    const etapa2 = [{ json: { rotulo: 'playlists' } }];
    const resultado = saida(executar(modelo, 'Normalizar', [recusada(403)], { 'Montar requisição': etapa1, 'Chamar API (analytics)': comNegado, 'Planejar etapa 2': etapa2 }));
    assert.equal(resultado.falhas[0]!.causa, 'reauth_pending');

    const semRecorte = respostas1.map((resposta, indice) => (etapa1[indice]!.json.rotulo === 'pais' ? recusada(400) : resposta));
    const parcial = saida(executar(modelo, 'Normalizar', [ok({ items: [] })], { 'Montar requisição': etapa1, 'Chamar API (analytics)': semRecorte, 'Planejar etapa 2': etapa2 }));
    assert.deepEqual(parcial.falhas, []);
    assert.ok(!tabelas(parcial.linhas).includes('pais'));
  });
});

describe('coletor GBP', () => {
  const modelo = carregar('coletor-gbp.json');
  const entrada: Item[] = [{ json: { fonte: { externalId: 'locations/555' }, janela: { start: '2026-11-20', end: '2027-01-05' }, modo: 'diario' } }];
  const pedidos = executar(modelo, 'Montar requisição', entrada, {});

  it('pede série diária, um mês de palavras-chave por mês da janela e o local', () => {
    const rotulos = pedidos.map((item) => item.json.rotulo);
    assert.deepEqual(rotulos, ['diario', 'palavras_chave', 'palavras_chave', 'palavras_chave', 'local']);
    assert.deepEqual(pedidos.filter((item) => item.json.mes).map((item) => item.json.mes), ['2026-11-01', '2026-12-01', '2027-01-01']);
    assert.ok(String(pedidos[0]!.json.url).includes('locations/555:fetchMultiDailyMetricsTimeSeries'));
  });

  it('normaliza série diária, palavras com valor e limiar, e o local', () => {
    const respostas = pedidos.map((item): Item => {
      switch (item.json.rotulo) {
        case 'diario':
          return ok({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{ dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 20 }, value: '4' }] } }] }] });
        case 'palavras_chave':
          return ok({ searchKeywordsCounts: [{ searchKeyword: 'pizza', insightsValue: { value: '120' } }, { searchKeyword: 'rara', insightsValue: { threshold: '15' } }] });
        default:
          return ok({ name: 'locations/555', title: 'Loja', categories: { primaryCategory: { displayName: 'Pizzaria' } }, storefrontAddress: { addressLines: ['Rua A, 1'], locality: 'SP', administrativeArea: 'SP', postalCode: '01000-000', regionCode: 'BR' }, openInfo: { status: 'OPEN' }, websiteUri: 'https://loja.example' });
      }
    });
    const resultado = saida(executar(modelo, 'Normalizar', respostas, { 'Montar requisição': pedidos }));
    assert.deepEqual(resultado.falhas, []);
    assert.deepEqual(tabelas(resultado.linhas), ['dim_local', 'padrao', 'palavras_chave']);
    const rara = resultado.linhas.find((linha) => linha.termo === 'rara')!;
    assert.equal(rara.valor, null);
    assert.equal(rara.limiar, 15);
    const local = resultado.linhas.find((linha) => linha._tabela === 'dim_local')!;
    assert.equal(local.categoriaPrimaria, 'Pizzaria');
    assert.equal(local.endereco, 'Rua A, 1');
  });

  it('API de informações desligada não derruba a série diária', () => {
    const respostas = pedidos.map((item): Item => {
      if (item.json.rotulo === 'diario') return ok({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{ dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 20 }, value: '4' }] } }] }] });
      return recusada(403);
    });
    const resultado = saida(executar(modelo, 'Normalizar', respostas, { 'Montar requisição': pedidos }));
    assert.deepEqual(resultado.falhas, []);
    assert.equal(resultado.linhas.length, 1);
  });

  it('série diária recusada por falta de acesso vira reauth_pending', () => {
    const respostas = pedidos.map((): Item => recusada(401));
    assert.equal(saida(executar(modelo, 'Normalizar', respostas, { 'Montar requisição': pedidos })).falhas[0]!.causa, 'reauth_pending');
  });
});
