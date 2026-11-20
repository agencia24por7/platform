import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  CAMPOS_DO_EVENTO,
  COLUNAS_DO_FATO_EVENTOS,
  OrigemDoEvento,
  agregarPorDia,
  eventoDaLinha,
  eventosUnicos,
  instanteDoBalde,
  limitesDaJanela,
  linhaDoFatoEventos,
  meiaNoiteNoFuso,
} from './eventosDoDataset.ts';

type No = { name: string; type: string; parameters: Record<string, unknown>; credentials?: Record<string, unknown>; executeOnce?: boolean };
type Modelo = { nodes: No[]; connections: Record<string, unknown>; settings: Record<string, unknown> };

const BASE_DO_GRAPH = 'https:' + '/'.repeat(2) + 'graph.facebook.com/v27.0/';
const modelo = JSON.parse(readFileSync('n8n/workflows/coletores/coletor-meta-dataset.json', 'utf8')) as Modelo;
const no = (nome: string): No => modelo.nodes.find((candidato) => candidato.name === nome)!;

const TOKEN = 'EAAG-token-que-nunca-pode-vazar-123';
const janela = { start: '2026-11-01', end: '2026-11-02' };

const balde = (startTime: string, data: { value: string; count: number }[]) => ({ start_time: startTime, aggregation: 'event', data });

const baldesTotais = [
  balde('2026-11-01T02:00:00+0000', [{ value: 'PageView', count: 4 }]),
  balde('2026-11-01T03:00:00+0000', [{ value: 'PageView', count: 10 }, { value: 'Lead', count: 2 }]),
  balde('2026-11-01T20:00:00+0000', [{ value: 'PageView', count: 5 }, { value: 'Lead', count: 1 }]),
  balde('2026-11-02T02:59:59+0000', [{ value: 'Purchase', count: 1 }]),
  balde('2026-11-02T03:00:00+0000', [{ value: 'PageView', count: 7 }]),
  balde('2026-11-03T03:00:00+0000', [{ value: 'PageView', count: 99 }]),
];

const resposta = (body: unknown, statusCode = 200) => ({ statusCode, headers: {}, body });
const pagina = (baldes: unknown[], proxima?: string) =>
  resposta({ data: baldes, paging: proxima ? { next: `${BASE_DO_GRAPH}123?access_token=${TOKEN}&after=${proxima}` } : {} });

function rodarMontar(fonte: Record<string, unknown>, janelaDaFonte = janela) {
  const codigo = String(no('Montar requisição').parameters.jsCode);
  const executar = new Function('$json', codigo) as (entrada: unknown) => { json: Record<string, unknown> }[];
  return executar({ fonte, janela: janelaDaFonte, modo: 'completa' })[0]!.json;
}

const NOS_DOS_RECORTES = [
  'Recorte (dispositivo)',
  'Recorte (sistema operacional)',
  'Recorte (navegador do visitante)',
  'Recorte (host)',
  'Recorte (chaves de correspondência)',
  'Recorte (resultado do processamento)',
];

type SaidaDoColetor = { linhas: Record<string, unknown>[]; falhas: { causa: string; detalhe: string | null }[] };

function rodarNormalizar(respostas: Record<'total' | 'navegador' | 'servidor', unknown[]>, datasetId = '1234567890'): SaidaDoColetor {
  const contexto = rodarMontar({ externalId: datasetId });
  const porNo: Record<string, unknown[]> = {
    'Montar requisição': [contexto],
    'Eventos (total)': respostas.total,
    'Eventos (navegador)': respostas.navegador,
    'Eventos (servidor)': respostas.servidor,
    Dataset: [resposta({ id: datasetId })],
    ...Object.fromEntries(NOS_DOS_RECORTES.map((nome) => [nome, [pagina([])]])),
  };
  const $ = (nome: string) => ({
    first: () => ({ json: porNo[nome]![0] }),
    all: () => porNo[nome]!.map((json) => ({ json })),
  });
  const codigo = String(no('Normalizar').parameters.jsCode);
  const executar = new Function('$', codigo) as (seletor: typeof $) => { json: SaidaDoColetor }[];
  return executar($)[0]!.json;
}

const ordenar = (linhas: readonly Record<string, unknown>[]) =>
  [...linhas].map((linha) => JSON.stringify(linha)).sort();

describe('agregação dos baldes por hora em dias de São Paulo', () => {
  it('meia-noite de São Paulo é 03:00 UTC', () => {
    assert.equal(meiaNoiteNoFuso('2026-11-01'), Date.UTC(2026, 10, 1, 3) / 1000);
  });

  it('a janela vai da meia-noite do primeiro dia à meia-noite do dia seguinte ao último', () => {
    assert.deepEqual(limitesDaJanela(janela), {
      startTime: Date.UTC(2026, 10, 1, 3) / 1000,
      endTime: Date.UTC(2026, 10, 3, 3) / 1000,
    });
  });

  it('lê start_time em ISO com +0000, em segundos e como texto numérico', () => {
    const esperado = Date.UTC(2026, 10, 1, 3);
    assert.equal(instanteDoBalde('2026-11-01T03:00:00+0000')!.getTime(), esperado);
    assert.equal(instanteDoBalde(esperado / 1000)!.getTime(), esperado);
    assert.equal(instanteDoBalde(String(esperado / 1000))!.getTime(), esperado);
    assert.equal(instanteDoBalde('lixo'), null);
  });

  it('soma por evento e por dia local: 23h de São Paulo fica no dia anterior', () => {
    const dias = agregarPorDia(baldesTotais, OrigemDoEvento.Total);
    assert.deepEqual(dias, [
      { dataDia: '2026-10-31', evento: 'PageView', origem: 'total', quantidade: 4 },
      { dataDia: '2026-11-01', evento: 'Lead', origem: 'total', quantidade: 3 },
      { dataDia: '2026-11-01', evento: 'PageView', origem: 'total', quantidade: 15 },
      { dataDia: '2026-11-01', evento: 'Purchase', origem: 'total', quantidade: 1 },
      { dataDia: '2026-11-02', evento: 'PageView', origem: 'total', quantidade: 7 },
      { dataDia: '2026-11-03', evento: 'PageView', origem: 'total', quantidade: 99 },
    ]);
  });

  it('com janela, descarta dias de fora', () => {
    const dias = agregarPorDia(baldesTotais, OrigemDoEvento.Total, janela);
    assert.ok(dias.every((dia) => dia.dataDia >= janela.start && dia.dataDia <= janela.end));
    assert.equal(dias.length, 4);
  });

  it('ignora balde sem data, evento sem nome e contagem negativa ou não numérica', () => {
    const dias = agregarPorDia(
      [
        { start_time: null, data: [{ value: 'Lead', count: 1 }] },
        balde('2026-11-01T12:00:00+0000', [
          { value: '', count: 1 },
          { value: 'Lead', count: -3 },
          { value: 'Lead', count: Number.NaN },
          { value: 'Lead', count: 2 },
        ]),
      ],
      OrigemDoEvento.Total,
    );
    assert.deepEqual(dias, [{ dataDia: '2026-11-01', evento: 'Lead', origem: 'total', quantidade: 2 }]);
  });
});

describe('linha do fato de eventos', () => {
  it('valida a linha que vem do n8n e deduplica pela chave', () => {
    assert.equal(eventoDaLinha({ dataDia: '01/11/2026', evento: 'Lead', origem: 'total', quantidade: 1 }), null);
    assert.equal(eventoDaLinha({ dataDia: '2026-11-01', evento: 'Lead', origem: 'outra', quantidade: 1 }), null);
    const unicos = eventosUnicos([
      { dataDia: '2026-11-01', evento: 'Lead', origem: 'total', quantidade: 1 },
      { dataDia: '2026-11-01', evento: 'Lead', origem: 'total', quantidade: 3 },
      { dataDia: '2026-11-01', evento: 'Lead', origem: 'servidor', quantidade: 2 },
    ]);
    assert.equal(unicos.length, 2);
    assert.equal(unicos.find((evento) => evento.origem === 'total')!.quantidade, 3);
  });

  it('preenche todas as colunas do fato', () => {
    const linha = linhaDoFatoEventos(
      { dataDia: '2026-11-01', evento: 'Lead', origem: 'total', quantidade: 3 },
      { organizationId: 'o', datasetId: '123456', execucaoId: 'e', inseridoEm: '2026-11-02T00:00:00.000Z' },
    );
    assert.deepEqual(Object.keys(linha).sort(), [...COLUNAS_DO_FATO_EVENTOS].sort());
    assert.equal(linha.dataset_id, '123456');
    assert.ok(!(COLUNAS_DO_FATO_EVENTOS as readonly string[]).includes('client_id'), 'o dono vem de dim_fonte_scd2');
  });
});

describe('coletor do conjunto de dados da Meta (modelo do n8n)', () => {
  it('toda chamada à Graph leva o Bearer do cofre, sem credencial por conexão no nó', () => {
    const chamadas = modelo.nodes.filter((candidato) => candidato.type === 'n8n-nodes-base.httpRequest' && candidato.name !== 'Obter token');
    assert.equal(chamadas.length, 3 + 1 + NOS_DOS_RECORTES.length);
    for (const chamada of chamadas) {
      assert.equal(chamada.parameters.authentication, 'none');
      assert.equal(chamada.credentials, undefined);
      const cabecalhos = (chamada.parameters.headerParameters as { parameters: { name: string; value: string }[] }).parameters;
      assert.equal(cabecalhos.find((cabecalho) => cabecalho.name === 'Authorization')!.value, "={{ 'Bearer ' + $('Obter token').first().json.body.token }}");
      assert.equal(chamada.executeOnce, true);
    }
  });

  it('o n8n não guarda a execução', () => {
    assert.equal(modelo.settings.saveDataSuccessExecution, 'none');
    assert.equal(modelo.settings.saveDataErrorExecution, 'none');
  });

  it('monta /stats por evento com a janela em São Paulo e um filtro por origem', () => {
    const contexto = rodarMontar({ externalId: '1234567890' }) as { urls: Record<string, string>; startTime: number; endTime: number };
    assert.deepEqual({ startTime: contexto.startTime, endTime: contexto.endTime }, limitesDaJanela(janela));
    for (const url of Object.values(contexto.urls)) {
      assert.ok(url.startsWith(`${BASE_DO_GRAPH}1234567890/stats?aggregation=event&`));
    }
    assert.ok(!contexto.urls.total!.includes('event_source'));
    assert.ok(contexto.urls.navegador!.endsWith('event_source=WEB_ONLY'));
    assert.ok(contexto.urls.servidor!.endsWith('event_source=SERVER_ONLY'));
  });

  it('agrega igual ao domínio, por origem, dentro da janela, juntando as páginas', () => {
    const saida = rodarNormalizar({
      total: [pagina(baldesTotais.slice(0, 3), 'p2'), pagina(baldesTotais.slice(3))],
      navegador: [pagina([balde('2026-11-01T12:00:00+0000', [{ value: 'PageView', count: 8 }])])],
      servidor: [pagina([balde('2026-11-01T12:00:00+0000', [{ value: 'Lead', count: 3 }])])],
    });
    assert.deepEqual(saida.falhas, []);
    const esperado = [
      ...agregarPorDia(baldesTotais, OrigemDoEvento.Total, janela),
      ...agregarPorDia([balde('2026-11-01T12:00:00+0000', [{ value: 'PageView', count: 8 }])], OrigemDoEvento.Navegador, janela),
      ...agregarPorDia([balde('2026-11-01T12:00:00+0000', [{ value: 'Lead', count: 3 }])], OrigemDoEvento.Servidor, janela),
    ];
    const eventos = saida.linhas.filter((linha) => !linha._tabela);
    assert.deepEqual(ordenar(eventos), ordenar(esperado));
    for (const linha of eventos) assert.deepEqual(Object.keys(linha).sort(), [...CAMPOS_DO_EVENTO].sort());
    assert.deepEqual(ordenar(eventosUnicos(eventos)), ordenar(eventos));
    assert.ok(!JSON.stringify(saida).includes(TOKEN));
  });

  it('token recusado vira reauth_pending, sem linhas', () => {
    const recusa = resposta({ error: { message: 'Error validating access token', code: 190 } }, 400);
    const saida = rodarNormalizar({ total: [recusa], navegador: [recusa], servidor: [recusa] });
    assert.deepEqual(saida.linhas, []);
    assert.equal(saida.falhas[0]!.causa, 'reauth_pending');
  });

  it('recorte por origem indisponível entrega o total e marca coleta incompleta', () => {
    const recusa = resposta({ error: { message: 'Invalid parameter', code: 100 } }, 400);
    const saida = rodarNormalizar({ total: [pagina(baldesTotais)], navegador: [recusa], servidor: [recusa] });
    assert.equal(saida.falhas[0]!.causa, 'coleta_incompleta');
    assert.ok(saida.linhas.length > 0);
    assert.ok(saida.linhas.filter((linha) => !linha._tabela).every((linha) => linha.origem === 'total'));
  });

  it('falha de rede não devolve o token que estiver na mensagem', () => {
    const falha = { error: { message: `connect ETIMEDOUT ${BASE_DO_GRAPH}1?access_token=${TOKEN}` } };
    const saida = rodarNormalizar({ total: [falha], navegador: [falha], servidor: [falha] });
    assert.equal(saida.falhas[0]!.causa, 'api_recusou');
    assert.ok(!JSON.stringify(saida).includes(TOKEN));
  });

  it('conjunto de dados sem evento no período é sem_dados_no_periodo', () => {
    const vazio = pagina([]);
    const saida = rodarNormalizar({ total: [vazio], navegador: [vazio], servidor: [vazio] });
    assert.equal(saida.falhas[0]!.causa, 'sem_dados_no_periodo');
  });

  it('id de conjunto de dados inválido não vira chamada aceita', () => {
    const saida = rodarNormalizar({ total: [pagina(baldesTotais)], navegador: [], servidor: [] }, '../me');
    assert.equal(saida.falhas[0]!.causa, 'api_recusou');
    assert.deepEqual(saida.linhas, []);
  });
});
