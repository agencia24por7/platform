import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ESQUEMAS_META, atributosDoEsquema, colunasDoEsquema, converterColuna, linhaTipada, tiposDoEsquema } from './esquemasMeta.ts';

type NoDoFluxo = { name: string; type: string; parameters: { jsCode?: string } };
type Linha = Record<string, unknown>;

const FLUXO = JSON.parse(
  readFileSync(new URL('../../../../n8n/workflows/coletores/coletor-meta-insights.json', import.meta.url), 'utf8'),
) as { nodes: NoDoFluxo[] };

const NOS_DE_CODIGO = FLUXO.nodes.filter((no) => no.type.endsWith('.code'));

function codigoDo(nome: string): string {
  const no = NOS_DE_CODIGO.find((candidato) => candidato.name === nome);
  assert.ok(no?.parameters.jsCode, `nó ${nome} sem código`);
  return no.parameters.jsCode;
}

function resposta(corpo: unknown, statusCode = 200): Linha {
  return { statusCode, body: corpo };
}

const RELATORIOS_CONCLUIDOS = ['anuncio', 'idade_genero', 'posicionamento', 'regiao'].map((chave) => ({
  chave, runId: `run-${chave}`, estado: 'concluido', causa: null, detalhe: null,
}));

function executarNormalizar(nos: Record<string, Linha[]>, relatorios: Linha[] = RELATORIOS_CONCLUIDOS): Linha {
  const contexto = { inicio: Date.now(), versaoApi: 'v27.0', fonte: { externalId: 'act_1', currency: 'BRL' } };
  const todos: Record<string, Linha[]> = {
    'Montar requisição': [contexto],
    'Preparar downloads': [{ relatorios, tentativa: 2, urls: {} }],
    ...nos,
  };
  const buscar = (nome: string) => {
    const itens = todos[nome];
    if (!itens) throw new Error(`nó ${nome} não executou`);
    return { first: () => ({ json: itens[0] }), all: () => itens.map((json) => ({ json })) };
  };
  const executar = new Function('$', codigoDo('Normalizar')) as (buscar: unknown) => { json: Linha }[];
  return executar(buscar)[0]!.json;
}

const ANUNCIO = {
  campaign_id: '10', campaign_name: 'Campanha A', adset_id: '20', ad_id: '30', date_start: '2026-11-10', account_currency: 'BRL',
  spend: '12.34', impressions: '1000', reach: '800', frequency: '1.25', clicks: '40', inline_link_clicks: '30',
  unique_clicks: '35', outbound_clicks: [{ action_type: 'outbound_click', value: '12' }],
  video_p25_watched_actions: [{ action_type: 'video_view', value: '7' }],
  video_avg_time_watched_actions: [{ action_type: 'video_view', value: '3.5' }],
  quality_ranking: 'AVERAGE',
  actions: [
    { action_type: 'lead', value: '5' },
    { action_type: 'purchase', value: '2' },
    { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4' },
  ],
  action_values: [{ action_type: 'purchase', value: '200.5' }],
  cost_per_action_type: [{ action_type: 'lead', value: '2.47' }],
  conversions: [{ action_type: 'offsite_conversion.custom.99', value: '3' }],
};

const RECORTE = {
  campaign_id: '10', adset_id: '20', date_start: '2026-11-10', account_currency: 'BRL',
  spend: '5', impressions: '100', reach: '90', clicks: '4', inline_link_clicks: '3',
  actions: [{ action_type: 'lead', value: '1' }],
};

function cenarioCompleto(): Record<string, Linha[]> {
  return {
    'Baixar anúncios': [resposta({ data: [ANUNCIO, { ...ANUNCIO, ad_id: '31', spend: '1.01' }] })],
    'Baixar idade e gênero': [resposta({ data: [{ ...RECORTE, age: '25-34', gender: 'female' }] })],
    'Baixar posicionamento': [resposta({ data: [{ ...RECORTE, publisher_platform: 'instagram', platform_position: 'feed' }] })],
    'Baixar região': [resposta({ data: [{ ...RECORTE, region: 'São Paulo' }, { ...RECORTE, adset_id: '' , region: 'x' }] })],
    'Listar campanhas': [resposta({
      data: [{ id: '10', name: 'Campanha A', objective: 'OUTCOME_LEADS', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '5000', special_ad_categories: ['NONE'] }],
    })],
    'Listar conjuntos': [resposta({
      data: [{
        id: '20', campaign_id: '10', name: 'Conj', optimization_goal: 'LEAD_GENERATION', billing_event: 'IMPRESSIONS', bid_amount: '250',
        attribution_spec: [{ event_type: 'VIEW_THROUGH', window_days: 1 }, { event_type: 'CLICK_THROUGH', window_days: 7 }],
        promoted_object: { page_id: '1', custom_event_type: 'LEAD' },
      }],
    })],
    'Listar anúncios': [resposta({ data: [{ id: '30', campaign_id: '10', adset_id: '20', name: 'Ad', creative: { id: '777' } }] })],
  };
}

function porTabela(linhas: Linha[], tabela: string): Linha[] {
  return linhas.filter((linha) => linha._tabela === tabela);
}

describe('converterColuna', () => {
  it('converte por tipo e devolve nulo para valor inválido', () => {
    assert.equal(converterColuna('INT64', '12.9'), 12);
    assert.equal(converterColuna('NUMERIC', '1.5'), 1.5);
    assert.equal(converterColuna('NUMERIC', 'abc'), null);
    assert.equal(converterColuna('DATE', '2026-11-10'), '2026-11-10');
    assert.equal(converterColuna('DATE', '10/11/2026'), null);
    assert.equal(converterColuna('TIMESTAMP', '2026-11-10T10:00:00-0300'), '2026-11-10T13:00:00.000Z');
    assert.equal(converterColuna('STRING', '  x  '), 'x');
    assert.equal(converterColuna('STRING', '   '), null);
    assert.equal(converterColuna('STRING', undefined), null);
  });
});

describe('esquemas do Meta Ads', () => {
  it('chave e cluster usam colunas do próprio esquema', () => {
    for (const esquema of Object.values(ESQUEMAS_META)) {
      const colunas = colunasDoEsquema(esquema);
      for (const coluna of [...esquema.chave, ...esquema.cluster]) assert.ok(colunas.includes(coluna), `${esquema.nome}.${coluna}`);
      if (esquema.colunaDeData) assert.ok(colunas.includes(esquema.colunaDeData));
    }
  });

  it('dimensão separa chave e atributos; fato acrescenta controle nos tipos', () => {
    assert.deepEqual(atributosDoEsquema(ESQUEMAS_META.dim_anuncio!).slice(0, 2), ['campaign_id', 'adset_id']);
    assert.equal(tiposDoEsquema(ESQUEMAS_META.entrega_diaria!).inserido_em, 'TIMESTAMP');
    assert.equal(tiposDoEsquema(ESQUEMAS_META.dim_anuncio!).inserido_em, undefined);
  });

  it('linhaTipada devolve todas as colunas, nulas quando ausentes', () => {
    const linha = linhaTipada(ESQUEMAS_META.dim_campanha!, { campaign_id: '1', orcamento_diario: '50' });
    assert.deepEqual(Object.keys(linha), colunasDoEsquema(ESQUEMAS_META.dim_campanha!));
    assert.equal(linha.orcamento_diario, 50);
    assert.equal(linha.nome, null);
  });
});

describe('coletor Meta Ads', () => {
  it('todos os nós de código compilam', () => {
    assert.ok(NOS_DE_CODIGO.length >= 6);
    for (const no of NOS_DE_CODIGO) assert.doesNotThrow(() => new Function('$', '$input', '$json', '$runIndex', no.parameters.jsCode!), no.name);
  });

  it('Normalizar produz as tabelas esperadas com as colunas do esquema', () => {
    const saida = executarNormalizar(cenarioCompleto());
    const linhas = saida.linhas as Linha[];
    assert.deepEqual(saida.falhas, []);
    for (const linha of linhas) {
      const esquema = linha._tabela ? ESQUEMAS_META[linha._tabela as string] : undefined;
      if (!linha._tabela) continue;
      assert.ok(esquema, `tabela ${String(linha._tabela)} sem esquema`);
      const colunas = colunasDoEsquema(esquema);
      for (const chave of Object.keys(linha)) assert.ok(chave === '_tabela' || chave === 'versaoApi' || colunas.includes(chave), `${esquema.nome}.${chave}`);
      for (const chave of esquema.chave) assert.ok(linha[chave] !== null && linha[chave] !== undefined && linha[chave] !== '', `${esquema.nome} sem ${chave}`);
    }
    assert.equal(porTabela(linhas, 'entrega_diaria').length, 2);
    assert.equal(porTabela(linhas, 'recorte_regiao').length, 1);
    assert.equal(porTabela(linhas, 'dim_campanha').length, 1);
  });

  it('entrega diária lê métricas e listas de vídeo e cliques de saída', () => {
    const linhas = executarNormalizar(cenarioCompleto()).linhas as Linha[];
    const entrega = porTabela(linhas, 'entrega_diaria')[0]!;
    assert.equal(entrega.investimento, 12.34);
    assert.equal(entrega.alcance, 800);
    assert.equal(entrega.frequencia, 1.25);
    assert.equal(entrega.cliques_saida, 12);
    assert.equal(entrega.video_p25, 7);
    assert.equal(entrega.video_p50, 0);
    assert.equal(entrega.video_tempo_medio, 3.5);
    assert.equal(entrega.ranking_qualidade, 'AVERAGE');
  });

  it('ações juntam quantidade, valor e custo por tipo, e separam conversões', () => {
    const linhas = executarNormalizar(cenarioCompleto()).linhas as Linha[];
    const acoes = porTabela(linhas, 'acoes_diarias').filter((linha) => linha.ad_id === '30');
    const compra = acoes.find((linha) => linha.tipo_acao === 'purchase')!;
    assert.equal(compra.quantidade, 2);
    assert.equal(compra.valor, 200.5);
    assert.equal(compra.custo_por_acao, null);
    assert.equal(compra.origem_metrica, 'acoes');
    assert.equal(compra.janela_atribuicao, 'unificada');
    assert.equal(acoes.find((linha) => linha.tipo_acao === 'lead')!.custo_por_acao, 2.47);
    const personalizada = acoes.find((linha) => linha.tipo_acao === 'offsite_conversion.custom.99')!;
    assert.equal(personalizada.origem_metrica, 'conversoes');
    assert.equal(personalizada.quantidade, 3);
  });

  it('padrão agrega anúncios por campanha e dia com compras', () => {
    const linhas = executarNormalizar(cenarioCompleto()).linhas as Linha[];
    const padrao = linhas.filter((linha) => !linha._tabela);
    assert.equal(padrao.length, 1);
    assert.equal(padrao[0]!.externalCampaignId, '10');
    assert.equal(padrao[0]!.spend, 13.35);
    assert.equal(padrao[0]!.conversions, 4);
    assert.equal(padrao[0]!.revenue, 401);
  });

  it('recortes extraem leads e descartam linhas sem conjunto', () => {
    const linhas = executarNormalizar(cenarioCompleto()).linhas as Linha[];
    const idade = porTabela(linhas, 'recorte_idade_genero')[0]!;
    assert.equal(idade.idade, '25-34');
    assert.equal(idade.genero, 'female');
    assert.equal(idade.leads, 1);
    assert.equal(porTabela(linhas, 'recorte_regiao').length, 1);
  });

  it('dimensões convertem orçamento, janela de atribuição e criativo', () => {
    const linhas = executarNormalizar(cenarioCompleto()).linhas as Linha[];
    const campanha = porTabela(linhas, 'dim_campanha')[0]!;
    assert.equal(campanha.orcamento_diario, 50);
    assert.equal(campanha.orcamento_vitalicio, null);
    const conjunto = porTabela(linhas, 'dim_conjunto')[0]!;
    assert.equal(conjunto.janela_atribuicao, 'CLICK_THROUGH:7,VIEW_THROUGH:1');
    assert.equal(conjunto.evento_conversao, 'LEAD');
    assert.equal(conjunto.valor_lance, 2.5);
    assert.equal(porTabela(linhas, 'dim_anuncio')[0]!.creative_id, '777');
  });

  it('relatório de anúncios sem dados vira sem_dados_no_periodo', () => {
    const cenario = { ...cenarioCompleto(), 'Baixar anúncios': [resposta({ data: [] })] };
    const saida = executarNormalizar(cenario);
    assert.deepEqual(saida.linhas, []);
    assert.deepEqual(saida.falhas, [{ causa: 'sem_dados_no_periodo', detalhe: null }]);
  });

  it('recorte indisponível mantém o resto e marca coleta_incompleta', () => {
    const relatorios = RELATORIOS_CONCLUIDOS.map((relatorio) => (
      relatorio.chave === 'regiao' ? { ...relatorio, estado: 'falhou', causa: 'api_recusou', detalhe: 'Job Failed' } : relatorio
    ));
    const saida = executarNormalizar(cenarioCompleto(), relatorios);
    assert.equal(porTabela(saida.linhas as Linha[], 'recorte_regiao').length, 0);
    assert.equal(porTabela(saida.linhas as Linha[], 'entrega_diaria').length, 2);
    assert.equal((saida.falhas as Linha[])[0]!.causa, 'coleta_incompleta');
  });

  it('erro de autorização no relatório de anúncios vira reauth_pending', () => {
    const relatorios = RELATORIOS_CONCLUIDOS.map((relatorio) => (
      relatorio.chave === 'anuncio' ? { ...relatorio, estado: 'falhou', causa: 'reauth_pending', detalhe: 'token' } : relatorio
    ));
    const saida = executarNormalizar(cenarioCompleto(), relatorios);
    assert.deepEqual(saida.linhas, []);
    assert.equal((saida.falhas as Linha[])[0]!.causa, 'reauth_pending');
  });

  it('resposta HTTP recusada no download de anúncios vira falha, com limite de uso como limite_de_uso', () => {
    const cenario = { ...cenarioCompleto(), 'Baixar anúncios': [resposta({ error: { code: 190, message: 'expirou' } }, 400)] };
    assert.equal(((executarNormalizar(cenario).falhas as Linha[])[0]!).causa, 'reauth_pending');
    const limite = { ...cenarioCompleto(), 'Baixar anúncios': [resposta({ error: { code: 17, message: 'User request limit reached' } }, 400)] };
    assert.equal(((executarNormalizar(limite).falhas as Linha[])[0]!).causa, 'limite_de_uso');
  });
});

describe('laço de relatórios assíncronos', () => {
  const contexto = { base: 'https://graph.facebook.com/v27.0', conta: 'act_1', relatorios: [{ chave: 'anuncio' }, { chave: 'regiao' }] };

  function executar(nome: string, indiceDaRodada: number, nos: Record<string, Linha[]>, entrada: Linha[]): Linha {
    const buscar = (no: string) => {
      const itens = nos[no] ?? [];
      return { first: () => ({ json: itens[0] }), all: () => itens.map((json) => ({ json })) };
    };
    const executarCodigo = new Function('$', '$input', '$runIndex', codigoDo(nome)) as (...argumentos: unknown[]) => { json: Linha }[];
    return executarCodigo(buscar, { all: () => entrada.map((json) => ({ json })) }, indiceDaRodada)[0]!.json;
  }

  it('registra o id do relatório e marca falha de início', () => {
    const saida = executar('Registrar relatórios', 0, { 'Montar requisição': [contexto] }, [
      resposta({ report_run_id: 123 }),
      resposta({ error: { code: 190, message: 'token' } }, 401),
    ]);
    const relatorios = saida.relatorios as Linha[];
    assert.deepEqual([relatorios[0]!.estado, relatorios[0]!.runId], ['pendente', '123']);
    assert.deepEqual([relatorios[1]!.estado, relatorios[1]!.causa], ['falhou', 'reauth_pending']);
  });

  it('avalia andamento, conclusão e esgotamento de tentativas', () => {
    const consultados = [
      { chave: 'anuncio', runId: '1', estado: 'pendente', causa: null, detalhe: null, consultaUrl: 'u' },
      { chave: 'regiao', runId: '2', estado: 'pendente', causa: null, detalhe: null, consultaUrl: 'u' },
    ];
    const respostas = [resposta({ async_status: 'Job Completed' }), resposta({ async_status: 'Job Running' })];
    const andamento = executar('Avaliar relatórios', 0, { 'Montar consulta': consultados }, respostas);
    assert.equal(andamento.terminou, false);
    assert.deepEqual((andamento.relatorios as Linha[]).map((relatorio) => relatorio.estado), ['concluido', 'pendente']);

    const esgotado = executar('Avaliar relatórios', 29, { 'Montar consulta': consultados }, respostas);
    assert.equal(esgotado.terminou, true);
    assert.deepEqual((esgotado.relatorios as Linha[]).map((relatorio) => relatorio.estado), ['concluido', 'falhou']);
  });

  it('monta consulta só para relatórios pendentes e usa URL neutra nos demais', () => {
    const estado = [
      { chave: 'anuncio', runId: '1', estado: 'concluido' },
      { chave: 'regiao', runId: '2', estado: 'pendente' },
    ];
    const buscar = (no: string) => ({
      first: () => ({ json: no === 'Montar requisição' ? contexto : { relatorios: estado } }),
      all: () => [{ json: { relatorios: estado } }],
    });
    const montar = new Function('$', '$runIndex', codigoDo('Montar consulta')) as (...argumentos: unknown[]) => { json: Linha }[];
    const itens = montar(buscar, 0);
    assert.equal(itens[0]!.json.consultaUrl, 'https://graph.facebook.com/v27.0/act_1?fields=id');
    assert.match(String(itens[1]!.json.consultaUrl), /\/2\?fields=id,async_status/);
  });
});
