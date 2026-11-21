import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  CAMPOS_DA_NEGOCIACAO,
  COLUNAS_DO_FATO_RD,
  Situacao,
  dataDoSnapshot,
  linhaDoFatoRd,
  negociacaoDaLinha,
  negociacoesUnicas,
  situacaoDa,
} from './negociacoesRd.ts';

type No = { name: string; type: string; parameters: Record<string, unknown>; credentials?: Record<string, unknown> };
type Modelo = { nodes: No[]; connections: Record<string, unknown> };

const BASE_DA_API = 'https:' + '/'.repeat(2) + 'crm.rdstation.com/api/v1/';
const modelo = JSON.parse(readFileSync('n8n/workflows/coletores/coletor-rdstation.json', 'utf8')) as Modelo;
const no = (nome: string): No => modelo.nodes.find((candidato) => candidato.name === nome)!;

const DADOS_PESSOAIS = [
  'Maria Joaquina de Souza',
  'maria.souza@exemplo.com.br',
  '+55 11 98888-7777',
  'Padaria da Maria LTDA',
  'vendedor@agencia.com.br',
  'Carlos Vendedor',
  '123.456.789-00',
  'ligar depois das 18h',
  'lead-meta-998877',
];

const funis = [
  {
    id: 'f1',
    name: 'Funil de crédito',
    order: 1,
    deal_stages: [
      { _id: 'e1', id: 'e1', name: 'Novo lead', nickname: 'NL', order: 1 },
      { _id: 'e2', id: 'e2', name: 'Análise de crédito', nickname: 'AC', order: 3 },
      { _id: 'e3', id: 'e3', name: 'Aprovado', nickname: 'AP', order: 7 },
    ],
  },
];

const negociacaoComDadosPessoais = (sobrescrever: Record<string, unknown>) => ({
  _id: 'd1',
  id: 'd1',
  name: 'Maria Joaquina de Souza - consignado',
  amount_total: 15000.5,
  amount_montly: 0,
  amount_unique: 15000.5,
  win: null,
  hold: null,
  closed_at: null,
  created_at: '2026-11-01T10:00:00.000-03:00',
  updated_at: '2026-11-10T12:00:00.000-03:00',
  rating: 3,
  interactions: 4,
  last_activity_content: 'ligar depois das 18h',
  deal_stage: { _id: 'e2', id: 'e2', name: 'Análise de crédito', nickname: 'AC' },
  deal_source: { _id: 's1', id: 's1', name: 'Facebook Ads' },
  campaign: { _id: 'c1', id: 'c1', name: 'Black Friday' },
  user: { _id: 'u1', id: 'u1', name: 'Carlos Vendedor', email: 'vendedor@agencia.com.br' },
  contacts: [
    {
      name: 'Maria Joaquina de Souza',
      emails: [{ email: 'maria.souza@exemplo.com.br' }],
      phones: [{ phone: '+55 11 98888-7777' }],
      notes: 'ligar depois das 18h',
    },
  ],
  organization: { _id: 'o1', id: 'o1', name: 'Padaria da Maria LTDA' },
  deal_custom_fields: [
    { custom_field_id: 'cf1', value: '123.456.789-00' },
    { custom_field_id: 'cf2', value: 'lead-meta-998877' },
  ],
  deal_products: [{ name: 'Consignado', amount: 1, price: 15000.5 }],
  ...sobrescrever,
});

const resposta = (body: unknown, statusCode = 200) => ({ statusCode, headers: {}, body });

const soNegociacoes = (linhas: readonly Record<string, unknown>[]) => linhas.filter((linha) => !linha._tabela);

type SaidaDoColetor = { linhas: Record<string, unknown>[]; falhas: { causa: string; detalhe: string | null }[] };

function rodarNormalizar(respostaDosFunis: unknown, paginas: readonly unknown[]): SaidaDoColetor {
  const codigo = String(no('Normalizar').parameters.jsCode);
  const porNo: Record<string, unknown> = {
    'Montar requisição': { inicio: Date.now(), versaoApi: 'crm-v1', fonte: {} },
    'Listar funis': respostaDosFunis,
  };
  const $ = (nome: string) => ({
    first: () => ({ json: porNo[nome] }),
    all: () => {
      if (!(nome in porNo)) throw new Error('nó não executado');
      return [{ json: porNo[nome] }];
    },
  });
  const $input = { all: () => paginas.map((json) => ({ json })) };
  const executar = new Function('$', '$input', codigo) as (seletor: typeof $, entrada: typeof $input) => { json: SaidaDoColetor }[];
  return executar($, $input)[0]!.json;
}

describe('coletor do RD Station (modelo do n8n)', () => {
  it('toda chamada ao RD leva o token do cofre na query, sem credencial por conexão no nó', () => {
    const chamadas = modelo.nodes.filter((candidato) => candidato.type === 'n8n-nodes-base.httpRequest' && candidato.name !== 'Obter token');
    assert.equal(chamadas.length, 7);
    for (const chamada of chamadas) {
      assert.equal(chamada.parameters.authentication, 'none');
      assert.equal(chamada.credentials, undefined);
      const query = (chamada.parameters.queryParameters as { parameters: { name: string; value: string }[] }).parameters;
      assert.ok(query.find((parametro) => parametro.name === 'token')!.value.includes("$('Obter token')"), chamada.name);
      assert.ok(String(chamada.parameters.url).startsWith(BASE_DA_API));
    }
  });

  it('o n8n não guarda a execução: a resposta da API traz contatos e só pode existir em memória', () => {
    const configuracao = (modelo as unknown as { settings: Record<string, unknown> }).settings;
    assert.equal(configuracao.saveDataSuccessExecution, 'none');
    assert.equal(configuracao.saveDataErrorExecution, 'none');
  });

  it('não lê nada dos fluxos do cliente Credaz', () => {
    const serializado = JSON.stringify(modelo);
    assert.ok(!serializado.toLowerCase().includes('credaz'));
    assert.ok(!serializado.includes('Proposta no banco'));
  });

  it('projeta só campos estruturais: nenhum dado pessoal sai do n8n', () => {
    const pagina = resposta({ deals: [negociacaoComDadosPessoais({})], has_more: false, total: 1 });
    const saida = rodarNormalizar(resposta(funis), [pagina]);

    assert.deepEqual(saida.falhas, []);
    assert.equal(soNegociacoes(saida.linhas).length, 1);
    assert.deepEqual(Object.keys(soNegociacoes(saida.linhas)[0]!).sort(), [...CAMPOS_DA_NEGOCIACAO].sort());

    const serializado = JSON.stringify(saida);
    for (const dado of DADOS_PESSOAIS) assert.ok(!serializado.includes(dado), `vazou: ${dado}`);
  });

  it('liga a etapa ao funil e à ordem vindos de /deal_pipelines', () => {
    const pagina = resposta({ deals: [negociacaoComDadosPessoais({})], has_more: false, total: 1 });
    const [linha] = soNegociacoes(rodarNormalizar(resposta(funis), [pagina]).linhas);
    assert.equal(linha!.pipelineId, 'f1');
    assert.equal(linha!.pipelineName, 'Funil de crédito');
    assert.equal(linha!.stageId, 'e2');
    assert.equal(linha!.stageName, 'Análise de crédito');
    assert.equal(linha!.stageOrder, 3);
    assert.equal(linha!.dealSourceName, 'Facebook Ads');
    assert.equal(linha!.campaignName, 'Black Friday');
  });

  it('o que o coletor entrega passa pelo domínio sem perder campo e sem dado pessoal', () => {
    const ganha = negociacaoComDadosPessoais({ win: true, closed_at: '2026-11-15T09:00:00.000-03:00' });
    const pagina = resposta({ deals: [ganha], has_more: false, total: 1 });
    const [negociacao] = negociacoesUnicas(soNegociacoes(rodarNormalizar(resposta(funis), [pagina]).linhas));
    assert.equal(negociacao!.situacao, Situacao.Ganha);
    assert.equal(negociacao!.amountTotal, 15000.5);
    assert.equal(negociacao!.closedAt, '2026-11-15T12:00:00.000Z');
    const serializado = JSON.stringify(negociacao);
    for (const dado of DADOS_PESSOAIS) assert.ok(!serializado.includes(dado), `vazou: ${dado}`);
  });

  it('negociação repetida entre páginas vira uma linha só', () => {
    const pagina = resposta({ deals: [negociacaoComDadosPessoais({})], has_more: true, next_page: 'x', total: 1 });
    const saida = rodarNormalizar(resposta(funis), [pagina, pagina]);
    assert.equal(soNegociacoes(saida.linhas).length, 1);
  });

  it('token recusado vira reauth_pending, sem linhas', () => {
    const saida = rodarNormalizar(resposta({ error: 'Token inválido' }, 401), []);
    assert.deepEqual(saida.linhas, []);
    assert.equal(saida.falhas[0]!.causa, 'reauth_pending');
  });

  it('CRM sem negociações é sem_dados_no_periodo, não falha', () => {
    const saida = rodarNormalizar(resposta(funis), [resposta({ deals: [], has_more: false, total: 0 })]);
    assert.equal(saida.falhas[0]!.causa, 'sem_dados_no_periodo');
  });

  it('funil que estoura o teto de paginação é marcado como coleta incompleta, mas entrega o que leu', () => {
    const paginas = Array.from({ length: 60 }, (_, indice) =>
      resposta({ deals: [negociacaoComDadosPessoais({ id: `d${indice}`, _id: `d${indice}` })], has_more: true, next_page: 'x', total: 99999 }),
    );
    const saida = rodarNormalizar(resposta(funis), paginas);
    assert.equal(soNegociacoes(saida.linhas).length, 60);
    assert.equal(saida.falhas[0]!.causa, 'coleta_incompleta');
  });
});

describe('situacaoDa', () => {
  it('win true é ganha (o Purchase), false é perdida, hold é pausada, resto aberta', () => {
    assert.equal(situacaoDa(true, null), Situacao.Ganha);
    assert.equal(situacaoDa(false, null), Situacao.Perdida);
    assert.equal(situacaoDa(null, true), Situacao.Pausada);
    assert.equal(situacaoDa(null, null), Situacao.Aberta);
    assert.equal(situacaoDa(true, true), Situacao.Ganha);
  });
});

describe('negociacaoDaLinha', () => {
  it('ignora qualquer campo fora da lista, mesmo que o coletor mande', () => {
    const negociacao = negociacaoDaLinha({
      dealId: 'd1',
      win: true,
      amountTotal: '2500.75',
      name: 'Maria Joaquina de Souza',
      contacts: [{ email: 'maria.souza@exemplo.com.br' }],
      deal_custom_fields: [{ value: '123.456.789-00' }],
    });
    assert.ok(negociacao);
    assert.equal(negociacao.situacao, Situacao.Ganha);
    assert.equal(negociacao.amountTotal, 2500.75);
    const serializado = JSON.stringify(negociacao);
    for (const dado of DADOS_PESSOAIS) assert.ok(!serializado.includes(dado), `vazou: ${dado}`);
  });

  it('sem id válido não vira linha', () => {
    assert.equal(negociacaoDaLinha({ dealId: '' }), null);
    assert.equal(negociacaoDaLinha({ dealId: 'Maria Joaquina' }), null);
    assert.equal(negociacaoDaLinha({}), null);
  });

  it('número e data inválidos viram nulo, não NaN', () => {
    const negociacao = negociacaoDaLinha({ dealId: 'd1', amountTotal: 'abc', createdAt: 'ontem', stageOrder: '2.7' });
    assert.equal(negociacao!.amountTotal, null);
    assert.equal(negociacao!.createdAt, null);
    assert.equal(negociacao!.stageOrder, 2);
  });
});

describe('negociacoesUnicas', () => {
  it('uma linha por negociação, ficando com a atualização mais recente', () => {
    const unicas = negociacoesUnicas([
      { dealId: 'd1', stageName: 'Novo lead', updatedAt: '2026-11-01T00:00:00Z' },
      { dealId: 'd1', stageName: 'Aprovado', updatedAt: '2026-11-05T00:00:00Z' },
      { dealId: 'd2', stageName: 'Novo lead' },
      { dealId: '' },
    ]);
    assert.equal(unicas.length, 2);
    assert.equal(unicas.find((negociacao) => negociacao.dealId === 'd1')!.stageName, 'Aprovado');
  });
});

describe('dataDoSnapshot', () => {
  it('usa o dia de São Paulo, não o de UTC', () => {
    assert.equal(dataDoSnapshot(new Date('2026-11-20T02:30:00Z')), '2026-11-19');
    assert.equal(dataDoSnapshot(new Date('2026-11-20T03:30:00Z')), '2026-11-20');
  });
});

describe('linhaDoFatoRd', () => {
  it('preenche exatamente as colunas do fato, com a chave (conta, negociação, dia) e sem client_id', () => {
    const negociacao = negociacaoDaLinha({ dealId: 'd1', pipelineId: 'f1', stageName: 'Aprovado', win: false })!;
    const linha = linhaDoFatoRd(negociacao, {
      organizationId: 'org',
      contaId: 'principal',
      dataSnapshot: '2026-11-20',
      moeda: 'BRL',
      execucaoId: 'exec',
      inseridoEm: '2026-11-20T12:00:00.000Z',
    });
    assert.deepEqual(Object.keys(linha).sort(), [...COLUNAS_DO_FATO_RD].sort());
    assert.equal(linha.conta_id, 'principal');
    assert.ok(!('client_id' in linha), 'o dono vem da dimensão, não do fato');
    assert.equal(linha.deal_id, 'd1');
    assert.equal(linha.data_snapshot, '2026-11-20');
    assert.equal(linha.situacao, Situacao.Perdida);
  });
});

describe('coletor do RD Station: 429 espera 60 s, repete uma vez e depois fecha como limite_de_uso', () => {
  const verificar = (respostasDoCrm: unknown[], paginas: unknown[], tentativa: number) => {
    const $ = (nome: string) => ({ all: () => (nome === 'Listar fontes' ? respostasDoCrm.map((json) => ({ json })) : []) });
    const executar = new Function('$input', '$', '$runIndex', String(no('Verificar limite').parameters.jsCode)) as (
      entrada: { all: () => { json: Record<string, unknown> }[] },
      seletor: typeof $,
      rodada: number,
    ) => { json: Record<string, unknown> }[];
    return executar({ all: () => paginas.map((json) => ({ json: json as Record<string, unknown> })) }, $, tentativa);
  };

  it('429 na primeira rodada pede repetição e preserva as páginas para o Normalizar', () => {
    const pagina = resposta({ deals: [], has_more: false, total: 0 });
    const saida = verificar([resposta({ error: 'limite' }, 429)], [pagina], 0);
    assert.equal(saida[0]!.json._repetir, true);
    assert.equal(saida[0]!.json.statusCode, 200);
  });

  it('429 na segunda rodada não repete de novo', () => {
    assert.equal(verificar([resposta({ error: 'limite' }, 429)], [resposta({ deals: [] })], 1)[0]!.json._repetir, false);
  });

  it('sem 429 não repete', () => {
    assert.equal(verificar([resposta([])], [resposta({ deals: [] })], 0)[0]!.json._repetir, false);
  });

  it('o fluxo espera 60 s e volta ao início da coleta', () => {
    assert.deepEqual(no('Esperar limite').parameters, { resume: 'timeInterval', amount: 60, unit: 'seconds' });
    const conexoes = modelo.connections as Record<string, { main: { node: string }[][] }>;
    assert.equal(conexoes['Esperar limite']!.main[0]![0]!.node, 'Listar fontes');
    assert.equal(conexoes['Repetir?']!.main[1]![0]!.node, 'Normalizar');
  });

  it('429 que persiste fecha como limite_de_uso com pausa temporária', () => {
    const saida = rodarNormalizar(resposta({ error: 'limite' }, 429), []);
    assert.equal(saida.falhas[0]!.causa, 'limite_de_uso');
    assert.equal((saida.falhas[0] as { pausa?: string }).pausa, 'limite_temporario');
  });
});
