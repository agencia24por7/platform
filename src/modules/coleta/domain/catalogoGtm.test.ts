import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  TabelaGtm,
  acionadorDaLinha,
  conteinerDaLinha,
  tagDaLinha,
  variavelDaLinha,
  versaoDaLinha,
  workspaceDaLinha,
} from './catalogoGtm.ts';

type No = { name: string; parameters: Record<string, unknown> };
type Modelo = { nodes: No[]; connections: Record<string, { main: { node: string }[][] }> };

const modelo = JSON.parse(readFileSync('n8n/workflows/coletores/coletor-gtm.json', 'utf8')) as Modelo;
const no = (nome: string): No => modelo.nodes.find((candidato) => candidato.name === nome)!;
const resposta = (body: unknown, statusCode = 200) => ({ statusCode, headers: {}, body });

const conteiner = {
  path: 'accounts/10/containers/20',
  name: 'Loja',
  accountId: '10',
  containerId: '20',
  usageContext: 'web',
  domainName: 'loja.exemplo.com.br',
};

const versaoPublicada = {
  containerVersionId: '42',
  name: 'Black Friday',
  tag: [
    { tagId: '1', name: 'GA4 - config', type: 'gaawc', firingTriggerId: ['5', '3'], blockingTriggerId: ['9'], parameter: [{ key: 'measurementId', value: 'G-SEGREDO123' }] },
    { tagId: '2', name: 'Pixel', type: 'html', firingTriggerId: ['5'], paused: true },
  ],
  trigger: [{ triggerId: '5', name: 'Todas as páginas', type: 'pageview' }, { triggerId: '3', name: 'Clique', type: 'click' }],
  variable: [{ variableId: '7', name: 'ID do GA4', type: 'c', parameter: [{ key: 'value', value: 'G-SEGREDO123' }] }],
};

type Saida = { linhas: Record<string, unknown>[]; falhas: { causa: string; detalhe: string | null }[] };

function rodar(versao: unknown, workspaces: unknown): Saida {
  const montar = new Function('$json', String(no('Montar requisição').parameters.jsCode)) as (entrada: unknown) => { json: unknown }[];
  const porNo: Record<string, unknown> = {
    'Montar requisição': montar({ fonte: { externalId: 'GTM-ABC123', nome: 'Loja' } })[0]!.json,
    'Encontrar contêiner': conteiner,
    'Versão publicada': versao,
    Workspaces: workspaces,
  };
  const $ = (nome: string) => ({
    first: () => ({ json: porNo[nome] }),
    all: () => {
      if (!(nome in porNo)) throw new Error('nó não executado');
      return [{ json: porNo[nome] }];
    },
  });
  const $input = { first: () => ({ json: workspaces }) };
  const executar = new Function('$', '$input', String(no('Normalizar').parameters.jsCode)) as (a: typeof $, b: typeof $input) => { json: Saida }[];
  return executar($, $input)[0]!.json;
}

const workspaces = resposta({ workspace: [{ workspaceId: '1', name: 'Default Workspace', description: 'texto livre' }] });
const daTabela = (saida: Saida, tabela: string) => saida.linhas.filter((linha) => linha._tabela === tabela);

describe('coletor do GTM: dimensões do contêiner', () => {
  it('lista workspaces depois da versão publicada e mantém o snapshot de governança', () => {
    assert.equal(modelo.connections['Versão publicada']!.main[0]![0]!.node, 'Workspaces');
    const saida = rodar(resposta(versaoPublicada), workspaces);
    assert.deepEqual(saida.falhas, []);
    const governanca = saida.linhas.filter((linha) => !linha._tabela);
    assert.equal(governanca.length, 1);
    assert.equal(governanca[0]!.estado, 'live v42 · 2 tags · 2 acionadores · 1 variáveis');
  });

  it('contêiner, workspace e versão publicada', () => {
    const saida = rodar(resposta(versaoPublicada), workspaces);
    assert.deepEqual(conteinerDaLinha(daTabela(saida, TabelaGtm.Conteiner)[0]!), {
      nome: 'Loja', conta_gtm_id: '10', conteiner_gtm_id: '20', contexto_de_uso: 'web', dominios: 'loja.exemplo.com.br',
    });
    assert.deepEqual(workspaceDaLinha(daTabela(saida, TabelaGtm.Workspace)[0]!), { workspace_id: '1', nome: 'Default Workspace' });
    assert.deepEqual(versaoDaLinha(daTabela(saida, TabelaGtm.Versao)[0]!), {
      versao_id: '42', nome: 'Black Friday', total_tags: 2, total_acionadores: 2, total_variaveis: 1,
    });
  });

  it('tags guardam tipo, acionadores ordenados e pausa, sem parâmetros', () => {
    const saida = rodar(resposta(versaoPublicada), workspaces);
    const tags = daTabela(saida, TabelaGtm.Tag).map((linha) => tagDaLinha(linha)!);
    assert.deepEqual(tags[0], {
      tag_id: '1', nome: 'GA4 - config', tipo: 'gaawc', acionadores_disparo: '3,5', acionadores_bloqueio: '9', pausada: false,
    });
    assert.equal(tags[1]!.pausada, true);
    assert.deepEqual(daTabela(saida, TabelaGtm.Acionador).map((linha) => acionadorDaLinha(linha)!.tipo), ['pageview', 'click']);
    assert.deepEqual(variavelDaLinha(daTabela(saida, TabelaGtm.Variavel)[0]!), { variavel_id: '7', nome: 'ID do GA4', tipo: 'c' });
    assert.ok(!JSON.stringify(saida).includes('G-SEGREDO123'));
  });

  it('contêiner sem versão publicada entrega o contêiner e nenhuma tag', () => {
    const saida = rodar(resposta({ error: { message: 'not found' } }, 404), workspaces);
    assert.deepEqual(saida.falhas, []);
    assert.equal(daTabela(saida, TabelaGtm.Conteiner).length, 1);
    assert.equal(daTabela(saida, TabelaGtm.Tag).length, 0);
  });

  it('falha ao listar workspaces não derruba a coleta', () => {
    const saida = rodar(resposta(versaoPublicada), resposta({ error: { message: 'x' } }, 500));
    assert.deepEqual(saida.falhas, []);
    assert.equal(daTabela(saida, TabelaGtm.Workspace).length, 0);
  });

  it('descarta id e tipo fora do padrão', () => {
    assert.equal(tagDaLinha({ tagId: 'abc' }), null);
    assert.equal(tagDaLinha({ tagId: '1', tipo: 'x; drop' })!.tipo, null);
    assert.equal(conteinerDaLinha({}), null);
  });
});
