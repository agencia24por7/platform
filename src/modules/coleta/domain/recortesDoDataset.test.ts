import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { AGREGACAO_DO_RECORTE, Recorte, TabelaPixel, datasetDaLinha, recorteDaLinha, valorDoRecorte } from './recortesDoDataset.ts';

type No = { name: string; parameters: Record<string, unknown> };
type Modelo = { nodes: No[] };

const modelo = JSON.parse(readFileSync('n8n/workflows/coletores/coletor-meta-dataset.json', 'utf8')) as Modelo;
const no = (nome: string): No => modelo.nodes.find((candidato) => candidato.name === nome)!;

const janela = { start: '2026-11-01', end: '2026-11-02' };
const resposta = (body: unknown, statusCode = 200) => ({ statusCode, headers: {}, body });
const pagina = (baldes: unknown[]) => resposta({ data: baldes, paging: {} });
const balde = (data: { value: string; count: number }[]) => ({ start_time: '2026-11-01T12:00:00+0000', data });

const NOS = {
  dispositivo: 'Recorte (dispositivo)',
  sistema_operacional: 'Recorte (sistema operacional)',
  navegador_do_visitante: 'Recorte (navegador do visitante)',
  host: 'Recorte (host)',
  chave_de_correspondencia: 'Recorte (chaves de correspondência)',
  resultado_do_processamento: 'Recorte (resultado do processamento)',
} as const;

type Saida = { linhas: Record<string, unknown>[]; falhas: { causa: string; detalhe: string | null }[] };

function rodar(recortes: Partial<Record<keyof typeof NOS, unknown[]>>, dataset: unknown = resposta({ id: '1234567890' })): Saida {
  const montar = new Function('$json', String(no('Montar requisição').parameters.jsCode)) as (entrada: unknown) => { json: unknown }[];
  const total = [pagina([balde([{ value: 'PageView', count: 5 }])])];
  const porNo: Record<string, unknown[]> = {
    'Montar requisição': [montar({ fonte: { externalId: '1234567890' }, janela, modo: 'completa' })[0]!.json],
    'Eventos (total)': total,
    'Eventos (navegador)': total,
    'Eventos (servidor)': total,
    Dataset: [dataset],
    ...Object.fromEntries(Object.entries(NOS).map(([recorte, nome]) => [nome, recortes[recorte as keyof typeof NOS] ?? [pagina([])]])),
  };
  const $ = (nome: string) => ({ first: () => ({ json: porNo[nome]![0] }), all: () => porNo[nome]!.map((json) => ({ json })) });
  const executar = new Function('$', String(no('Normalizar').parameters.jsCode)) as (seletor: typeof $) => { json: Saida }[];
  return executar($)[0]!.json;
}

const daTabela = (saida: Saida, tabela: string) => saida.linhas.filter((linha) => linha._tabela === tabela);

describe('recortes do /stats', () => {
  it('cada recorte pede a agregação certa e nenhuma pede url, que pode trazer dado pessoal', () => {
    const contexto = new Function('$json', String(no('Montar requisição').parameters.jsCode))({
      fonte: { externalId: '1234567890' },
      janela,
      modo: 'completa',
    })[0].json as { recortes: Record<string, string> };
    for (const [recorte, agregacao] of Object.entries(AGREGACAO_DO_RECORTE)) {
      assert.ok(contexto.recortes[recorte]!.includes(`/stats?aggregation=${agregacao}&`), recorte);
    }
    assert.ok(!Object.values(contexto.recortes).some((url) => /aggregation=url/.test(url)));
  });

  it('soma por dia local, recorte e valor', () => {
    const saida = rodar({
      dispositivo: [pagina([balde([{ value: 'mobile', count: 7 }, { value: 'desktop', count: 3 }]), balde([{ value: 'mobile', count: 1 }])])],
    });
    assert.deepEqual(saida.falhas, []);
    const linhas = daTabela(saida, TabelaPixel.Recortes).map((linha) => recorteDaLinha(linha)!);
    assert.deepEqual(
      linhas.map((linha) => [linha.data_dia, linha.recorte, linha.valor, linha.quantidade]).sort(),
      [['2026-11-01', 'dispositivo', 'desktop', 3], ['2026-11-01', 'dispositivo', 'mobile', 8]],
    );
  });

  it('host guarda só o nome do servidor: caminho, parâmetros e esquema ficam de fora', () => {
    const saida = rodar({
      host: [pagina([balde([{ value: 'https://Loja.exemplo.com.br/obrigado?email=maria@x.com', count: 2 }, { value: 'a b@c', count: 1 }])])],
    });
    const hosts = daTabela(saida, TabelaPixel.Recortes).map((linha) => linha.valor);
    assert.deepEqual(hosts, ['loja.exemplo.com.br']);
    assert.ok(!JSON.stringify(saida).includes('maria@x.com'));
  });

  it('recorte que a Meta recusa entrega o resto e marca a coleta incompleta', () => {
    const recusa = resposta({ error: { message: 'Invalid aggregation', code: 100 } }, 400);
    const saida = rodar({ host: [recusa] });
    assert.equal(saida.falhas[0]!.causa, 'coleta_incompleta');
    assert.ok(saida.falhas[0]!.detalhe!.includes('host'));
    assert.ok(saida.linhas.some((linha) => linha.origem === 'total'));
  });

  it('dimensão do conjunto de dados traz só a ficha, sem código do pixel', () => {
    const saida = rodar({}, resposta({
      id: '1234567890',
      name: 'Pixel da Loja',
      is_unavailable: false,
      enable_automatic_matching: true,
      first_party_cookie_status: 'FIRST_PARTY_COOKIE_ENABLED',
      data_use_setting: 'EMPTY',
      code: '<script>fbq()</script>',
    }));
    const [linha] = daTabela(saida, TabelaPixel.Dataset);
    assert.deepEqual(datasetDaLinha(linha!), {
      nome: 'Pixel da Loja',
      indisponivel: false,
      correspondencia_automatica: true,
      cookie_primeira_parte: 'FIRST_PARTY_COOKIE_ENABLED',
      uso_de_dados: 'EMPTY',
    });
    assert.ok(!JSON.stringify(saida).includes('fbq'));
    assert.ok(!JSON.stringify(no('Dataset').parameters).includes('code'));
  });

  it('valida o valor do recorte e rejeita recorte desconhecido', () => {
    assert.equal(valorDoRecorte(Recorte.Dispositivo, 'mobile; drop'), null);
    assert.equal(recorteDaLinha({ dataDia: '2026-11-01', recorte: 'url', valor: 'x', quantidade: 1 }), null);
    assert.equal(datasetDaLinha({}), null);
  });
});
