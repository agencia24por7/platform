import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  CAMPOS_DO_FORMULARIO,
  COLUNAS_DO_FATO_FORMULARIOS,
  formularioDaLinha,
  formulariosUnicos,
  linhaDoFatoFormularios,
} from './formulariosMeta.ts';

type No = {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  credentials?: Record<string, unknown>;
};
type Modelo = { nodes: No[]; connections: Record<string, unknown>; settings: Record<string, unknown> };

const BASE_DO_GRAPH = 'https:' + '/'.repeat(2) + 'graph.facebook.com/v27.0/';
const modelo = JSON.parse(readFileSync('n8n/workflows/coletores/coletor-meta-formularios.json', 'utf8')) as Modelo;
const no = (nome: string): No => modelo.nodes.find((candidato) => candidato.name === nome)!;

const TOKEN_DA_PAGINA = 'EAAPageToken-que-nunca-pode-vazar-987';
const DADOS_PESSOAIS = ['Maria Joaquina de Souza', 'maria.souza@exemplo.com.br', '+55 11 98888-7777', '123.456.789-00'];

const resposta = (body: unknown, statusCode = 200) => ({ statusCode, headers: {}, body });

const formularioComDadosPessoais = (sobrescrever: Record<string, unknown> = {}) => ({
  id: '111222333444',
  name: 'Cadastro Black Friday',
  status: 'ACTIVE',
  leads_count: 42,
  expired_leads_count: 3,
  created_time: '2026-10-01T12:00:00+0000',
  page: { id: '999888777', access_token: TOKEN_DA_PAGINA },
  questions: [{ key: 'email', label: 'E-mail' }],
  leads: {
    data: [
      {
        id: '555',
        field_data: [
          { name: 'full_name', values: ['Maria Joaquina de Souza'] },
          { name: 'email', values: ['maria.souza@exemplo.com.br'] },
          { name: 'phone_number', values: ['+55 11 98888-7777'] },
          { name: 'cpf', values: ['123.456.789-00'] },
        ],
      },
    ],
  },
  ...sobrescrever,
});

type SaidaDoColetor = { linhas: Record<string, unknown>[]; falhas: { causa: string; detalhe: string | null }[] };

function rodarNormalizar(
  respostaDoToken: unknown,
  paginas: readonly unknown[],
  pageId = '999888777',
  paginasDeLeads: readonly unknown[] = [],
): SaidaDoColetor {
  const montar = new Function('$json', String(no('Montar requisição').parameters.jsCode)) as (
    entrada: unknown,
  ) => { json: Record<string, unknown> }[];
  const porNo: Record<string, unknown> = {
    'Montar requisição': montar({ fonte: { externalId: pageId }, janela: { start: '2026-11-19', end: '2026-11-19' } })[0]!.json,
    'Token da Página': respostaDoToken,
  };
  const $ = (nome: string) => ({
    first: () => ({ json: porNo[nome] }),
    all: () => paginas.map((json) => ({ json })),
  });
  const $input = { all: () => paginasDeLeads.map((json) => ({ json })) };
  const executar = new Function('$', '$input', String(no('Normalizar').parameters.jsCode)) as (
    seletor: typeof $,
    entrada: typeof $input,
  ) => { json: SaidaDoColetor }[];
  return executar($, $input)[0]!.json;
}

const comToken = resposta({ access_token: TOKEN_DA_PAGINA, id: '999888777' });

describe('coletor de formulários da Meta (modelo do n8n)', () => {
  it('pede o token da Página com a credencial do usuário e lista os formulários com ele, sem credencial no nó', () => {
    const token = no('Token da Página');
    assert.equal(token.parameters.authentication, 'predefinedCredentialType');
    assert.equal(token.parameters.nodeCredentialType, 'facebookGraphApi');
    assert.ok(token.credentials && 'facebookGraphApi' in token.credentials);

    const listar = no('Listar formulários');
    assert.equal(listar.parameters.authentication, 'none');
    assert.equal(listar.credentials, undefined);
    assert.ok(String(listar.parameters.url).startsWith("=https://graph.facebook.com/{{ $('Montar requisição').first().json.versaoApi }}/"));
    assert.ok(String(listar.parameters.url).endsWith('/leadgen_forms'));
    const query = (listar.parameters.queryParameters as { parameters: { name: string; value: string }[] }).parameters;
    assert.ok(query.find((parametro) => parametro.name === 'access_token')!.value.includes("$('Token da Página')"));
    assert.deepEqual(
      query.find((parametro) => parametro.name === 'fields')!.value.split(',').sort(),
      ['created_time', 'expired_leads_count', 'id', 'leads_count', 'locale', 'name', 'questions{type}', 'status'],
    );
  });

  it('nunca lê as respostas dos leads: só id de anúncio, de campanha e de formulário e a data', () => {
    const chamadas = modelo.nodes.filter((candidato) => candidato.type === 'n8n-nodes-base.httpRequest');
    assert.ok(!/field_data|leads\{|leads\.limit/.test(JSON.stringify(chamadas)));
    const leads = no('Leads do formulário');
    const query = (leads.parameters.queryParameters as { parameters: { name: string; value: string }[] }).parameters;
    assert.deepEqual(query.find((parametro) => parametro.name === 'fields')!.value.split(',').sort(), ['ad_id', 'campaign_id', 'created_time', 'form_id']);
    assert.equal(leads.parameters.authentication, 'none');
    assert.equal(leads.credentials, undefined);
  });

  it('o n8n não guarda a execução: o token da Página só existe em memória', () => {
    assert.equal(modelo.settings.saveDataSuccessExecution, 'none');
    assert.equal(modelo.settings.saveDataErrorExecution, 'none');
  });

  it('projeta só metadados e contagens: sem dado pessoal e sem token', () => {
    const saida = rodarNormalizar(comToken, [resposta({ data: [formularioComDadosPessoais()], paging: {} })]);
    assert.deepEqual(saida.falhas, []);
    const padrao = saida.linhas.filter((linha) => !linha._tabela);
    assert.equal(padrao.length, 1);
    assert.deepEqual(Object.keys(padrao[0]!).sort(), [...CAMPOS_DO_FORMULARIO].sort());
    assert.equal(padrao[0]!.leadsTotal, 42);
    assert.equal(padrao[0]!.leadsExpirados, 3);

    const serializado = JSON.stringify(saida);
    assert.ok(!serializado.includes(TOKEN_DA_PAGINA));
    for (const dado of DADOS_PESSOAIS) assert.ok(!serializado.includes(dado), `vazou: ${dado}`);
  });

  it('o que o coletor entrega passa pelo domínio sem perder campo', () => {
    const saida = rodarNormalizar(comToken, [
      resposta({ data: [formularioComDadosPessoais()], paging: { next: `${BASE_DO_GRAPH}x?access_token=${TOKEN_DA_PAGINA}` } }),
      resposta({ data: [formularioComDadosPessoais({ id: '111222333555', status: 'ARCHIVED', expired_leads_count: undefined })] }),
    ]);
    const formularios = formulariosUnicos(saida.linhas.filter((linha) => !linha._tabela));
    assert.equal(formularios.length, 2);
    assert.equal(formularios[0]!.criadoEm, '2026-10-01T12:00:00.000Z');
    assert.equal(formularios[1]!.status, 'ARCHIVED');
    assert.equal(formularios[1]!.leadsExpirados, null);
  });

  it('sem token da Página vira reauth_pending, sem chamar os formulários', () => {
    const saida = rodarNormalizar(resposta({ id: '999888777' }), [resposta({ data: [formularioComDadosPessoais()] })]);
    assert.deepEqual(saida.linhas, []);
    assert.equal(saida.falhas[0]!.causa, 'reauth_pending');
  });

  it('token do usuário recusado vira reauth_pending', () => {
    const saida = rodarNormalizar(resposta({ error: { message: 'Error validating access token', code: 190 } }, 400), []);
    assert.equal(saida.falhas[0]!.causa, 'reauth_pending');
  });

  it('erro na listagem não devolve o token da Página, nem na mensagem', () => {
    const saida = rodarNormalizar(comToken, [
      resposta({ error: { message: `Invalid token ${TOKEN_DA_PAGINA} for access_token=${TOKEN_DA_PAGINA}`, code: 1 } }, 500),
    ]);
    assert.equal(saida.falhas[0]!.causa, 'api_recusou');
    assert.ok(!JSON.stringify(saida).includes(TOKEN_DA_PAGINA));
  });

  it('falha de rede na listagem não devolve o token da URL', () => {
    const saida = rodarNormalizar(comToken, [{ error: { message: `ETIMEDOUT ${BASE_DO_GRAPH}1/leadgen_forms?access_token=${TOKEN_DA_PAGINA}` } }]);
    assert.ok(!JSON.stringify(saida).includes(TOKEN_DA_PAGINA));
  });

  it('Página sem formulário é sem_dados_no_periodo', () => {
    const saida = rodarNormalizar(comToken, [resposta({ data: [] })]);
    assert.equal(saida.falhas[0]!.causa, 'sem_dados_no_periodo');
  });

  it('id de Página inválido para antes de qualquer leitura', () => {
    const saida = rodarNormalizar(comToken, [], '../me');
    assert.equal(saida.falhas[0]!.causa, 'api_recusou');
  });
});

describe('linha do fato de formulários', () => {
  it('recusa id que não é da Meta e status fora do padrão', () => {
    assert.equal(formularioDaLinha({ formId: 'abc' }), null);
    assert.equal(formularioDaLinha({ formId: '123456', status: 'ativo; drop' })!.status, null);
  });

  it('preenche todas as colunas do fato com o page_id da fonte', () => {
    const formulario = formularioDaLinha({ formId: '123456', nome: 'Form', status: 'ACTIVE', leadsTotal: '7', criadoEm: '2026-10-01T12:00:00+0000' })!;
    const linha = linhaDoFatoFormularios(formulario, {
      organizationId: 'o',
      pageId: '999888777',
      dataSnapshot: '2026-11-20',
      execucaoId: 'e',
      inseridoEm: '2026-11-20T00:00:00.000Z',
    });
    assert.deepEqual(Object.keys(linha).sort(), [...COLUNAS_DO_FATO_FORMULARIOS].sort());
    assert.equal(linha.leads_total, 7);
    assert.equal(linha.page_id, '999888777');
    assert.ok(!(COLUNAS_DO_FATO_FORMULARIOS as readonly string[]).includes('client_id'), 'o dono vem de dim_fonte_scd2');
  });
});
