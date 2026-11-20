import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ARQUIVO_DOS_ALERTAS, NOTA_DE_ORIGEM, mesclar, resolverFluxoDeErro, versaoDoModelo, type Workflow } from './sincronizacao.ts';

const lerModelo = (caminho: string) => JSON.parse(readFileSync(caminho, 'utf8')) as Workflow & { nodes: { name: string; type: string; parameters: Record<string, unknown> }[] };

const comNota = (id: string, arquivo: string): Workflow & { id: string } => ({
  id,
  name: 'ORLA · plataforma · alertas de falha',
  settings: {},
  connections: {},
  nodes: [{ name: NOTA_DE_ORIGEM, type: 'n8n-nodes-base.stickyNote', parameters: { content: `## Gerado pelo repositório\nArquivo: \`${arquivo}\`\n\nversão: 0123456789abcdef` } }],
});

const modelo: Workflow = {
  name: 'ORLA · exemplo',
  settings: { executionOrder: 'v1', errorWorkflow: `origem:${ARQUIVO_DOS_ALERTAS}` },
  connections: {},
  nodes: [],
};

describe('resolução do fluxo de erro pela nota de origem', () => {
  it('troca a referência pelo id do workflow implantado com a nota do arquivo', () => {
    const { modelo: resolvido, aviso } = resolverFluxoDeErro(modelo, [comNota('abc123', ARQUIVO_DOS_ALERTAS)]);
    assert.equal(resolvido.settings['errorWorkflow'], 'abc123');
    assert.equal(aviso, null);
  });

  it('não resolve pelo nome: workflow sem nota de origem é ignorado e o errorWorkflow sai', () => {
    const semNota = { ...comNota('abc123', ARQUIVO_DOS_ALERTAS), nodes: [] };
    const { modelo: resolvido, aviso } = resolverFluxoDeErro(modelo, [semNota]);
    assert.ok(!('errorWorkflow' in resolvido.settings));
    assert.match(aviso ?? '', /ainda não implantado/);
  });

  it('dois workflows apontando para o mesmo arquivo é erro', () => {
    assert.throws(() => resolverFluxoDeErro(modelo, [comNota('a', ARQUIVO_DOS_ALERTAS), comNota('b', ARQUIVO_DOS_ALERTAS)]), /mais de um/);
  });

  it('modelo sem referência passa intacto, inclusive id literal', () => {
    const literal: Workflow = { ...modelo, settings: { errorWorkflow: 'xyz' } };
    assert.equal(resolverFluxoDeErro(literal, []).modelo, literal);
  });

  it('o id resolvido entra no corpo enviado e muda a versão do modelo', () => {
    const { modelo: resolvido } = resolverFluxoDeErro(modelo, [comNota('abc123', ARQUIVO_DOS_ALERTAS)]);
    assert.equal(mesclar(resolvido, null, 'ORLA · exemplo', 'n8n/workflows/exemplo.json').corpo.settings['errorWorkflow'], 'abc123');
    assert.notEqual(versaoDoModelo(resolvido), versaoDoModelo(resolverFluxoDeErro(modelo, []).modelo));
  });
});

describe('fluxos da plataforma usam só o fluxo de alertas da plataforma', () => {
  const arquivos = [
    ...readdirSync('n8n/workflows').filter((nome) => nome.endsWith('.json')).map((nome) => `n8n/workflows/${nome}`),
    ...readdirSync('n8n/workflows/plataforma').filter((nome) => nome.endsWith('.json')).map((nome) => `n8n/workflows/plataforma/${nome}`),
  ];

  it('todos apontam para a origem do fluxo de alertas, exceto ele mesmo', () => {
    assert.ok(arquivos.length >= 8);
    for (const arquivo of arquivos) {
      const { settings } = lerModelo(arquivo);
      if (arquivo === ARQUIVO_DOS_ALERTAS) assert.ok(!('errorWorkflow' in settings), 'o fluxo de alertas não pode ter errorWorkflow');
      else assert.equal(settings['errorWorkflow'], `origem:${ARQUIVO_DOS_ALERTAS}`, arquivo);
    }
  });

  it('nenhum fluxo da plataforma referencia o fluxo da agência', () => {
    for (const arquivo of arquivos) assert.ok(!readFileSync(arquivo, 'utf8').includes('im3mfvd9pUI79e74'), arquivo);
  });

  it('o fluxo de alertas só fala com o app, sem credencial externa nem salvar dados', () => {
    const alertas = lerModelo(ARQUIVO_DOS_ALERTAS);
    assert.equal(alertas.settings['saveDataErrorExecution'], 'none');
    assert.equal(alertas.settings['saveDataSuccessExecution'], 'none');
    const tipos = alertas.nodes.map((no) => no.type).sort();
    assert.deepEqual(tipos, ['n8n-nodes-base.code', 'n8n-nodes-base.errorTrigger', 'n8n-nodes-base.httpRequest']);
    const chamada = alertas.nodes.find((no) => no.type === 'n8n-nodes-base.httpRequest')!;
    assert.equal(chamada.parameters?.['url'], '=http://app:3000/api/v0/manutencao/alerta');
    assert.equal(chamada.parameters?.['genericAuthType'], 'httpHeaderAuth');
  });
});
