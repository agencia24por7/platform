import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { MODELO_DE_COLETOR, MODELO_DE_EXECUTOR, PASTAS_DE_MODELO } from './modelos.ts';
import { NOTA_DE_ORIGEM, arquivoDeOrigem, avaliarAlvo, localizarImplantado, mesclar, versaoDoModelo, versaoImplantada, type Workflow } from './sincronizacao.ts';

const CREDENCIAL_REAL = { id: 'AbCdEfGh12345678', name: 'ORLA · worker token' };
const ARQUIVO = 'n8n/workflows/exemplo.json';

const doRepositorio: Workflow = {
  name: 'ORLA · exemplo',
  settings: { executionOrder: 'v1' },
  connections: { Gatilho: { main: [[{ node: 'Chamar app', type: 'main', index: 0 }]] } },
  nodes: [
    { name: 'Gatilho', type: 'n8n-nodes-base.webhook', parameters: { path: 'entrada' } },
    {
      name: 'Chamar app',
      type: 'n8n-nodes-base.httpRequest',
      parameters: { url: 'https://app/v2' },
      credentials: { httpHeaderAuth: { id: 'a-definir-pelo-provisioner', name: 'a-definir' } },
    },
    {
      name: 'Sub-workflow',
      type: 'n8n-nodes-base.executeWorkflow',
      parameters: { workflowId: { __rl: true, mode: 'id', value: 'a-definir-na-importacao' } },
    },
  ],
};

const implantado: Workflow = {
  name: 'ORLA · exemplo',
  settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner' },
  connections: doRepositorio.connections,
  nodes: [
    { name: 'Gatilho', type: 'n8n-nodes-base.webhook', id: 'no-1', webhookId: 'gancho-estavel', parameters: { path: 'entrada' } },
    {
      name: 'Chamar app',
      type: 'n8n-nodes-base.httpRequest',
      parameters: { url: 'https://app/v1' },
      credentials: { httpHeaderAuth: CREDENCIAL_REAL },
    },
    {
      name: 'Sub-workflow',
      type: 'n8n-nodes-base.executeWorkflow',
      parameters: { workflowId: { __rl: true, mode: 'id', value: 'Wf0000000000000A' } },
    },
  ],
};

const no = (workflow: { nodes: readonly unknown[] }, nome: string) =>
  workflow.nodes.find((n) => (n as { name: string }).name === nome) as Record<string, any>;

describe('sincronização de workflows do n8n', () => {
  it('a lógica vem do repositório e os vínculos vêm da instância', () => {
    const { corpo, pendencias } = mesclar(doRepositorio, implantado, implantado.name, ARQUIVO);

    assert.deepEqual(pendencias, []);
    assert.equal(no(corpo, 'Chamar app').parameters.url, 'https://app/v2');
    assert.deepEqual(no(corpo, 'Chamar app').credentials.httpHeaderAuth, CREDENCIAL_REAL);
    assert.equal(no(corpo, 'Sub-workflow').parameters.workflowId.value, 'Wf0000000000000A');
    assert.equal(no(corpo, 'Gatilho').webhookId, 'gancho-estavel');
  });

  it('nó novo herda a credencial do mesmo tipo já vinculada em outro nó', () => {
    const comNoNovo: Workflow = {
      ...doRepositorio,
      nodes: [
        ...doRepositorio.nodes,
        { name: 'Novo passo', type: 'n8n-nodes-base.httpRequest', credentials: { httpHeaderAuth: { id: 'a-definir', name: 'x' } } },
      ],
    };
    const { corpo, pendencias } = mesclar(comNoNovo, implantado, implantado.name, ARQUIVO);

    assert.deepEqual(pendencias, []);
    assert.deepEqual(no(corpo, 'Novo passo').credentials.httpHeaderAuth, CREDENCIAL_REAL);
  });

  it('sem instância, marcador vira pendência em vez de ir para o n8n como se fosse id', () => {
    const { pendencias } = mesclar(doRepositorio, null, doRepositorio.name, ARQUIVO);

    assert.deepEqual(pendencias, ['Chamar app: credencial httpHeaderAuth sem vínculo', 'Sub-workflow: sub-workflow sem vínculo']);
  });

  it('referência por expressão a sub-workflow não é tratada como vínculo', () => {
    const porExpressao: Workflow = {
      ...doRepositorio,
      nodes: [{ name: 'Dinâmico', type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { __rl: true, mode: 'id', value: '={{ $json.ref }}' } } }],
    };
    const { corpo, pendencias } = mesclar(porExpressao, null, 'x', ARQUIVO);

    assert.deepEqual(pendencias, []);
    assert.equal(no(corpo, 'Dinâmico').parameters.workflowId.value, '={{ $json.ref }}');
  });

  it('marca a versão do modelo numa nota, e a versão lida de volta é a mesma', () => {
    const { corpo } = mesclar(doRepositorio, implantado, implantado.name, ARQUIVO);
    const nota = no(corpo, NOTA_DE_ORIGEM);

    assert.equal(nota.type, 'n8n-nodes-base.stickyNote');
    assert.ok(nota.parameters.content.includes(ARQUIVO));
    assert.equal(versaoImplantada(corpo as Workflow), versaoDoModelo(doRepositorio));
    assert.equal(versaoImplantada(implantado), null);
  });

  it('a versão muda quando a lógica muda e não depende da ordem das chaves', () => {
    const reordenado = Object.fromEntries(Object.entries(doRepositorio).reverse()) as Workflow;
    const alterado: Workflow = { ...doRepositorio, settings: { executionOrder: 'v0' } };

    assert.equal(versaoDoModelo(reordenado), versaoDoModelo(doRepositorio));
    assert.notEqual(versaoDoModelo(alterado), versaoDoModelo(doRepositorio));
  });

  it('não duplica a nota quando o modelo já vem com ela', () => {
    const { corpo } = mesclar(doRepositorio, implantado, implantado.name, ARQUIVO);
    const deNovo = mesclar(corpo as Workflow, implantado, implantado.name, ARQUIVO).corpo;

    assert.equal(deNovo.nodes.filter((n) => (n as { name: string }).name === NOTA_DE_ORIGEM).length, 1);
  });

  it('o mapa de modelos cobre todo arquivo de modelo e só aponta para arquivos que existem', () => {
    const mapeados = new Set([...Object.values(MODELO_DE_COLETOR), ...Object.values(MODELO_DE_EXECUTOR)]);
    for (const caminho of mapeados) assert.ok(existsSync(caminho), caminho);

    const arquivos = PASTAS_DE_MODELO.flatMap((pasta) => readdirSync(pasta).map((arquivo) => `${pasta}${arquivo}`));
    for (const arquivo of arquivos) assert.ok(mapeados.has(arquivo), `${arquivo} fora do mapa de modelos`);
  });
  it('localiza pelo arquivo de origem gravado na nota, mesmo se o workflow foi renomeado', () => {
    const { corpo } = mesclar(doRepositorio, implantado, 'Nome antigo', ARQUIVO);
    const renomeado = { ...(corpo as Workflow), name: 'Alguém renomeou no editor', id: 'wfA' };
    const homonimo = { ...implantado, name: doRepositorio.name, id: 'wfB' };

    assert.equal(arquivoDeOrigem(renomeado), ARQUIVO);
    const achado = localizarImplantado(ARQUIVO, doRepositorio.name, [homonimo, renomeado]);
    assert.equal(achado?.workflow.id, 'wfA');
    assert.equal(achado?.por, 'arquivo');
  });

  it('só adota pelo nome quem ainda não tem origem, e recusa ambiguidade', () => {
    const semNota = { ...implantado, id: 'wfC' };
    assert.equal(localizarImplantado(ARQUIVO, implantado.name, [semNota])?.por, 'nome');
    assert.throws(() => localizarImplantado(ARQUIVO, implantado.name, [semNota, { ...semNota, id: 'wfD' }]), /mais de um/);
  });
});

describe('segurança da sincronização: quem pode ser alterado', () => {
  const comOrigem = mesclar(doRepositorio, null, 'ORLA · exemplo', ARQUIVO).corpo as Workflow;
  const semOrigem = { ...doRepositorio, tags: [] as { name: string }[] };
  const opcoes = { adotar: false, tagDaPlataforma: 'platform' };

  it('workflow com tag credaz ou agencia nunca é tocado, nem com --adotar', () => {
    for (const tag of ['credaz', 'agencia', 'Credaz']) {
      const alvo = { ...comOrigem, tags: [{ name: 'platform' }, { name: tag }] };
      assert.equal(avaliarAlvo(alvo, opcoes).permitido, false);
      assert.equal(avaliarAlvo(alvo, { ...opcoes, adotar: true }).permitido, false);
    }
  });

  it('sem nota de origem nem tag platform só é assumido com --adotar', () => {
    const recusa = avaliarAlvo(semOrigem, opcoes);
    assert.equal(recusa.permitido, false);
    assert.match((recusa as { motivo: string }).motivo, /--adotar/);
    assert.equal(avaliarAlvo(semOrigem, { ...opcoes, adotar: true }).permitido, true);
  });

  it('com nota de origem ou com a tag platform segue normalmente', () => {
    assert.equal(avaliarAlvo({ ...comOrigem, tags: [] }, opcoes).permitido, true);
    assert.equal(avaliarAlvo({ ...semOrigem, tags: [{ name: 'platform' }] }, opcoes).permitido, true);
  });
});
