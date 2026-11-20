import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { SEM_ANUNCIO, SEM_CAMPANHA, TabelaLeadAds, formularioDaLinha, leadsDoDiaDaLinha, paginaDaLinha } from './leadsMeta.ts';

type No = { name: string; parameters: Record<string, unknown> };
type Modelo = { nodes: No[]; connections: Record<string, { main: { node: string }[][] }> };

const modelo = JSON.parse(readFileSync('n8n/workflows/coletores/coletor-meta-formularios.json', 'utf8')) as Modelo;
const no = (nome: string): No => modelo.nodes.find((candidato) => candidato.name === nome)!;

const TOKEN = 'EAAPageToken-que-nunca-pode-vazar-987';
const DADOS_PESSOAIS = ['Maria Joaquina de Souza', 'maria.souza@exemplo.com.br', '+55 11 98888-7777'];
const resposta = (body: unknown, statusCode = 200) => ({ statusCode, headers: {}, body });

type Saida = { linhas: Record<string, unknown>[]; falhas: { causa: string; detalhe: string | null }[] };

function rodar(formularios: unknown[], leads: unknown[], paginaDoToken: Record<string, unknown> = {}): Saida {
  const montar = new Function('$json', String(no('Montar requisição').parameters.jsCode)) as (entrada: unknown) => { json: unknown }[];
  const porNo: Record<string, unknown> = {
    'Montar requisição': montar({ fonte: { externalId: '999888777' } })[0]!.json,
    'Token da Página': resposta({ access_token: TOKEN, id: '999888777', ...paginaDoToken }),
  };
  const $ = (nome: string) => ({
    first: () => ({ json: porNo[nome] }),
    all: () => formularios.map((json) => ({ json })),
  });
  const $input = { all: () => leads.map((json) => ({ json })) };
  const executar = new Function('$', '$input', String(no('Normalizar').parameters.jsCode)) as (a: typeof $, b: typeof $input) => { json: Saida }[];
  return executar($, $input)[0]!.json;
}

const formulario = {
  id: '111222333444',
  name: 'Cadastro Black Friday',
  status: 'ACTIVE',
  leads_count: 3,
  locale: 'pt_BR',
  questions: [{ type: 'FULL_NAME', label: 'Nome' }, { type: 'EMAIL', label: 'E-mail' }, { type: 'CUSTOM', key: 'renda' }, { type: 'CUSTOM', key: 'cargo' }],
};
const paginaDeFormularios = resposta({ data: [formulario], paging: {} });

const lead = (sobrescrever: Record<string, unknown>) => ({
  id: '777',
  created_time: '2026-11-19T12:00:00+0000',
  ad_id: '600000000001',
  campaign_id: '700000000001',
  form_id: '111222333444',
  field_data: [{ name: 'email', values: ['maria.souza@exemplo.com.br'] }, { name: 'full_name', values: ['Maria Joaquina de Souza'] }],
  ...sobrescrever,
});

const daTabela = (saida: Saida, tabela: string) => saida.linhas.filter((linha) => linha._tabela === tabela);

describe('coletor de formulários: dimensões e leads por dia', () => {
  it('o filtro de leads usa a data de criação e o coletor passa pelo item por formulário', () => {
    assert.equal(modelo.connections['Tem formulário?']!.main[0]![0]!.node, 'Leads do formulário');
    const filtro = JSON.stringify(no('Leads do formulário').parameters.queryParameters);
    assert.ok(filtro.includes('time_created'));
  });

  it('dimensão do formulário traz só tipos e contagem de perguntas, nunca o texto', () => {
    const saida = rodar([paginaDeFormularios], [], { name: 'Página da Loja', category: 'Loja' });
    const [linha] = daTabela(saida, TabelaLeadAds.Formulario);
    assert.deepEqual(formularioDaLinha(linha!), {
      form_id: '111222333444',
      nome: 'Cadastro Black Friday',
      status: 'ACTIVE',
      idioma: 'pt_BR',
      perguntas_total: 4,
      tipos_de_pergunta: 'CUSTOM,EMAIL,FULL_NAME',
    });
    const [pagina] = daTabela(saida, TabelaLeadAds.Pagina);
    assert.deepEqual(paginaDaLinha(pagina!), { nome: 'Página da Loja', categoria: 'Loja' });
    const serializado = JSON.stringify(saida);
    assert.ok(!serializado.includes('renda') && !serializado.includes('E-mail'));
  });

  it('conta leads por formulário, dia de São Paulo, anúncio e campanha, sem dado pessoal nem token', () => {
    const leads = resposta({
      data: [
        lead({}),
        lead({ id: '778' }),
        lead({ id: '779', created_time: '2026-11-20T01:30:00+0000' }),
        lead({ id: '780', ad_id: undefined, campaign_id: undefined }),
      ],
      paging: { next: `https://graph.facebook.com/v23.0/x?access_token=${TOKEN}` },
    });
    const saida = rodar([paginaDeFormularios], [leads]);
    assert.deepEqual(saida.falhas, []);
    const diarios = daTabela(saida, TabelaLeadAds.LeadsDiarios).map((linha) => leadsDoDiaDaLinha(linha)!);
    assert.equal(diarios.length, 2);
    const porDia = (dia: string, anuncio: string) => diarios.find((linha) => linha.data_dia === dia && linha.anuncio_id === anuncio)!;
    assert.equal(porDia('2026-11-19', '600000000001').leads, 3);
    assert.equal(porDia('2026-11-19', SEM_ANUNCIO).campanha_id, SEM_CAMPANHA);
    const serializado = JSON.stringify(saida);
    for (const dado of [...DADOS_PESSOAIS, TOKEN, '"777"']) assert.ok(!serializado.includes(dado), `vazou: ${dado}`);
  });

  it('falha ao ler leads entrega formulários e marca a coleta como incompleta, sem o token', () => {
    const recusada = resposta({ error: { message: `sem permissão ${TOKEN}`, code: 200 } }, 403);
    const saida = rodar([paginaDeFormularios], [recusada]);
    assert.equal(saida.falhas[0]!.causa, 'coleta_incompleta');
    assert.ok(saida.linhas.some((linha) => !linha._tabela));
    assert.ok(!JSON.stringify(saida).includes(TOKEN));
  });
});

describe('conversores de leadads', () => {
  it('recusa lead sem formulário, sem data ou com contagem negativa', () => {
    assert.equal(leadsDoDiaDaLinha({ formId: 'abc', dataDia: '2026-11-19', leads: 1 }), null);
    assert.equal(leadsDoDiaDaLinha({ formId: '123456', dataDia: 'ontem', leads: 1 }), null);
    assert.equal(leadsDoDiaDaLinha({ formId: '123456', dataDia: '2026-11-19', leads: -1 }), null);
  });

  it('descarta tipo de pergunta fora do padrão', () => {
    assert.equal(formularioDaLinha({ formId: '123456', tiposDePergunta: 'EMAIL,maria@x.com' })!.tipos_de_pergunta, 'EMAIL');
  });
});
