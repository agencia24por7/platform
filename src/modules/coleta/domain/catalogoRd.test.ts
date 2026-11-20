import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  TabelaRd,
  campanhaDaLinha,
  etapaDaLinha,
  etapaDaNegociacaoDaLinha,
  funilDaLinha,
  produtoDaLinha,
  produtoDaNegociacaoDaLinha,
  tarefaPorDiaDaLinha,
  usuarioDaLinha,
} from './catalogoRd.ts';

type No = { name: string; parameters: Record<string, unknown> };
type Modelo = { nodes: No[]; connections: Record<string, { main: { node: string }[][] }> };

const modelo = JSON.parse(readFileSync('n8n/workflows/coletores/coletor-rdstation.json', 'utf8')) as Modelo;
const no = (nome: string): No => modelo.nodes.find((candidato) => candidato.name === nome)!;
const resposta = (body: unknown, statusCode = 200) => ({ statusCode, headers: {}, body });

const funis = [
  { id: 'f1', name: 'Funil de crédito', deal_stages: [{ id: 'e1', name: 'Novo lead', order: 1 }, { id: 'e2', name: 'Aprovado', order: 7 }] },
];

const DADOS_PESSOAIS = ['Maria Joaquina de Souza', 'maria.souza@exemplo.com.br', 'Carlos Vendedor', 'vendedor@agencia.com.br', 'ligar para a Maria', '+55 11 98888-7777'];

const negociacao = {
  id: 'd1',
  name: 'Maria Joaquina de Souza - consignado',
  deal_stage: { id: 'e2', name: 'Aprovado' },
  deal_source: { id: 's1', name: 'Facebook Ads' },
  campaign: { id: 'c1', name: 'Black Friday' },
  user: { id: 'u1', name: 'Carlos Vendedor', email: 'vendedor@agencia.com.br' },
  contacts: [{ name: 'Maria Joaquina de Souza', emails: [{ email: 'maria.souza@exemplo.com.br' }] }],
  deal_products: [
    { id: 'dp1', product_id: 'p1', name: 'Consignado', amount: 2, price: 100, discount: 5, total: 195 },
    { id: 'dp2', name: 'Seguro', amount: 1, price: 50, total: 50 },
  ],
  deal_stage_histories: [
    { deal_stage: { id: 'e1', name: 'Novo lead' }, created_at: '2026-11-01T10:00:00.000-03:00', user: { name: 'Carlos Vendedor' } },
    { deal_stage: { id: 'e2' }, created_at: '2026-11-05T23:30:00.000-03:00' },
  ],
};

type Saida = { linhas: Record<string, unknown>[]; falhas: { causa: string; detalhe: string | null }[] };

function rodar(extras: Record<string, unknown[]>, deals: unknown[] = [negociacao]): Saida {
  const montar = new Function('$json', String(no('Montar requisição').parameters.jsCode)) as (entrada: unknown) => { json: unknown }[];
  const porNo: Record<string, unknown[]> = {
    'Montar requisição': [montar({ fonte: {} })[0]!.json],
    'Listar funis': [resposta(funis)],
    ...extras,
  };
  const $ = (nome: string) => ({
    first: () => ({ json: porNo[nome]![0] }),
    all: () => {
      if (!porNo[nome]) throw new Error('nó não executado');
      return porNo[nome]!.map((json) => ({ json }));
    },
  });
  const $input = { all: () => [{ json: resposta({ deals, has_more: false, total: deals.length }) }] };
  const executar = new Function('$', '$input', String(no('Normalizar').parameters.jsCode)) as (a: typeof $, b: typeof $input) => { json: Saida }[];
  return executar($, $input)[0]!.json;
}

const daTabela = (saida: Saida, tabela: string) => saida.linhas.filter((linha) => linha._tabela === tabela);

describe('coletor do RD Station: catálogo, produtos, histórico e tarefas', () => {
  it('lê catálogos em série antes dos funis e só pelo token da query', () => {
    const cadeia = ['Montar requisição', 'Listar fontes', 'Listar campanhas', 'Listar produtos', 'Listar usuários', 'Listar tarefas', 'Listar funis'];
    for (let i = 0; i < cadeia.length - 1; i += 1) assert.equal(modelo.connections[cadeia[i]!]!.main[0]![0]!.node, cadeia[i + 1]);
    for (const nome of cadeia.slice(1, -1)) assert.equal(no(nome).parameters.genericAuthType, 'httpQueryAuth');
  });

  it('funis e etapas viram dimensões com nome e ordem', () => {
    const saida = rodar({});
    assert.deepEqual(daTabela(saida, TabelaRd.Funil).map((linha) => funilDaLinha(linha)), [{ funil_id: 'f1', nome: 'Funil de crédito' }]);
    assert.deepEqual(
      daTabela(saida, TabelaRd.Etapa).map((linha) => etapaDaLinha(linha)),
      [
        { etapa_id: 'e1', funil_id: 'f1', nome: 'Novo lead', ordem: 1 },
        { etapa_id: 'e2', funil_id: 'f1', nome: 'Aprovado', ordem: 7 },
      ],
    );
  });

  it('fonte, campanha, produto e usuário: o usuário sai só como id opaco', () => {
    const saida = rodar({
      'Listar fontes': [resposta({ deal_sources: [{ id: 's1', name: 'Facebook Ads' }] })],
      'Listar campanhas': [resposta({ campaigns: [{ id: 'c1', name: 'Black Friday' }] })],
      'Listar produtos': [resposta({ products: [{ id: 'p1', name: 'Consignado', base_price: 100, visible: true }] })],
      'Listar usuários': [resposta({ users: [{ id: 'u1', name: 'Carlos Vendedor', email: 'vendedor@agencia.com.br', active: true }] })],
    });
    assert.deepEqual(daTabela(saida, TabelaRd.Usuario).map((linha) => usuarioDaLinha(linha)), [{ usuario_id: 'u1', ativo: true }]);
    assert.deepEqual(daTabela(saida, TabelaRd.Produto).map((linha) => produtoDaLinha(linha)), [{ produto_id: 'p1', nome: 'Consignado', preco: 100, ativo: true }]);
    assert.deepEqual(daTabela(saida, TabelaRd.Campanha).map((linha) => campanhaDaLinha(linha)), [{ campanha_id: 'c1', nome: 'Black Friday' }]);
    assert.equal(daTabela(saida, TabelaRd.Fonte).length, 1);
    const negociacaoDoDia = saida.linhas.find((linha) => !linha._tabela)!;
    assert.equal(negociacaoDoDia.userId, 'u1');
    assert.equal(negociacaoDoDia.dealSourceId, 's1');
    assert.equal(negociacaoDoDia.campaignId, 'c1');
  });

  it('produtos por negociação trazem quantidade, preço e total, sem o texto do produto', () => {
    const saida = rodar({});
    const produtos = daTabela(saida, TabelaRd.ProdutoDaNegociacao).map((linha) => produtoDaNegociacaoDaLinha('2026-11-20')(linha)!);
    assert.equal(produtos.length, 2);
    assert.deepEqual(produtos[0], {
      deal_id: 'd1', deal_produto_id: 'dp1', produto_id: 'p1', quantidade: 2, preco: 100, desconto: 5, total: 195, data_snapshot: '2026-11-20',
    });
    assert.equal(produtos[1]!.produto_id, null);
  });

  it('histórico de etapas vira um evento por entrada, no dia de São Paulo', () => {
    const saida = rodar({});
    const eventos = daTabela(saida, TabelaRd.EtapaDaNegociacao).map((linha) => etapaDaNegociacaoDaLinha(linha)!);
    assert.deepEqual(eventos.map((evento) => [evento.etapa_id, evento.entrou_em, evento.data_dia]), [
      ['e1', '2026-11-01T13:00:00.000Z', '2026-11-01'],
      ['e2', '2026-11-06T02:30:00.000Z', '2026-11-05'],
    ]);
  });

  it('tarefas viram contagem por dia, tipo e status, sem assunto, notas nem responsável', () => {
    const tarefa = (sobrescrever: Record<string, unknown>) => ({
      id: 't', subject: 'ligar para a Maria', notes: '+55 11 98888-7777', date: '2026-11-20T09:00:00.000-03:00', type: 'call', done: false,
      users: [{ name: 'Carlos Vendedor', email: 'vendedor@agencia.com.br' }], ...sobrescrever,
    });
    const saida = rodar({
      'Listar tarefas': [resposta({ tasks: [tarefa({}), tarefa({}), tarefa({ done: true }), tarefa({ type: 'estranho; x' }), tarefa({ date: null })], has_more: false })],
    });
    const resumo = daTabela(saida, TabelaRd.TarefaPorDia).map((linha) => tarefaPorDiaDaLinha(linha)!);
    assert.deepEqual(resumo.map((linha) => [linha.data_dia, linha.tipo, linha.status, linha.quantidade]).sort(), [
      ['2026-11-20', 'call', 'concluida', 1],
      ['2026-11-20', 'call', 'pendente', 2],
      ['2026-11-20', 'outro', 'pendente', 1],
    ]);
  });

  it('nenhum dado pessoal da API chega às linhas', () => {
    const saida = rodar({
      'Listar usuários': [resposta({ users: [{ id: 'u1', name: 'Carlos Vendedor', email: 'vendedor@agencia.com.br' }] })],
      'Listar tarefas': [resposta({ tasks: [{ id: 't', subject: 'ligar para a Maria', date: '2026-11-20', type: 'call' }], has_more: false })],
    });
    const serializado = JSON.stringify(saida);
    for (const dado of DADOS_PESSOAIS) assert.ok(!serializado.includes(dado), `vazou: ${dado}`);
  });

  it('tarefas além do teto de paginação marcam a coleta como incompleta, sem perder as lidas', () => {
    const saida = rodar({ 'Listar tarefas': [resposta({ tasks: [{ id: 't', date: '2026-11-20', type: 'call' }], has_more: true })] });
    assert.equal(saida.falhas[0]!.causa, 'coleta_incompleta');
    assert.equal(daTabela(saida, TabelaRd.TarefaPorDia).length, 1);
  });

  it('catálogo que a API recusa não derruba a coleta das negociações', () => {
    const saida = rodar({ 'Listar produtos': [resposta({ error: 'sem acesso' }, 403)] });
    assert.deepEqual(saida.falhas, []);
    assert.equal(daTabela(saida, TabelaRd.Produto).length, 0);
  });
});

describe('conversores do RD Station', () => {
  it('descartam linha sem id válido e valor fora do tipo', () => {
    assert.equal(funilDaLinha({ funilId: 'Maria Joaquina' }), null);
    assert.equal(tarefaPorDiaDaLinha({ dataDia: '2026-11-20', tipo: 'call', status: 'feita', quantidade: 1 }), null);
    assert.equal(tarefaPorDiaDaLinha({ dataDia: '2026-11-20', tipo: 'call', status: 'pendente', quantidade: -1 }), null);
    assert.equal(etapaDaNegociacaoDaLinha({ dealId: 'd1', etapaId: 'e1', entrouEm: 'ontem' }), null);
    assert.equal(produtoDaNegociacaoDaLinha('2026-11-20')({ dealId: 'd1' }), null);
  });
});
