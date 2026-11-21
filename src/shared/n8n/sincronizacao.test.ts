import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  COLETOR_DA_PLATAFORMA,
  EXECUTOR_DA_PLATAFORMA,
  PASTA_DOS_COLETORES,
  PASTA_DOS_EXECUTORES,
  WORKFLOWS_DA_PLATAFORMA,
  WORKFLOW_DE_CONFORMIDADE_DO_YOUTUBE,
  WORKFLOW_DE_RENOVACAO_DE_TOKENS,
  ehSubWorkflowGenerico,
  ordemDeImplantacao,
} from './modelos.ts';
import {
  NOTA_DE_ORIGEM,
  arquivoDeOrigem,
  avaliarAlvo,
  credenciaisPorNome,
  localizarImplantado,
  mesclar,
  modeloComCredenciaisPorNome,
  resolverSubWorkflows,
  versaoDoModelo,
  versaoImplantada,
  type Workflow,
} from './sincronizacao.ts';

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

  it('o mapa dos genéricos cobre todo coletor e executor e só aponta para arquivos que existem', () => {
    const mapeados = new Set([...Object.values(COLETOR_DA_PLATAFORMA), ...Object.values(EXECUTOR_DA_PLATAFORMA)]);
    for (const caminho of mapeados) assert.ok(existsSync(caminho), caminho);

    const arquivos = [PASTA_DOS_COLETORES, PASTA_DOS_EXECUTORES].flatMap((pasta) => readdirSync(pasta).map((arquivo) => `${pasta}${arquivo}`));
    for (const arquivo of arquivos) assert.ok(mapeados.has(arquivo), `${arquivo} fora do mapa dos genéricos`);
    for (const arquivo of arquivos) assert.equal(ehSubWorkflowGenerico(arquivo), true, arquivo);
  });

  it('implanta alertas, depois os genéricos, depois a janela do backfill e por fim quem os chama', () => {
    assert.equal(ordemDeImplantacao('n8n/workflows/plataforma/alertas-de-falha.json'), 0);
    assert.equal(ordemDeImplantacao(COLETOR_DA_PLATAFORMA.ga4!), 1);
    assert.equal(ordemDeImplantacao(EXECUTOR_DA_PLATAFORMA.google!), 1);
    assert.ok(ordemDeImplantacao('n8n/workflows/coleta-backfill-janela.json') < ordemDeImplantacao('n8n/workflows/coleta-backfill.json'));
    assert.ok(ordemDeImplantacao(COLETOR_DA_PLATAFORMA.ga4!) < ordemDeImplantacao('n8n/workflows/coleta-orquestrador.json'));
    assert.ok(ordemDeImplantacao(EXECUTOR_DA_PLATAFORMA.meta!) < ordemDeImplantacao('n8n/workflows/tarefas-de-conta.json'));
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

type NoDoModelo = { name: string; type: string; parameters?: Record<string, unknown>; credentials?: Record<string, { id: string; name: string }> };
type ModeloLido = { name: string; nodes: NoDoModelo[]; settings: Record<string, unknown> };
const ler = (caminho: string) => JSON.parse(readFileSync(caminho, 'utf8')) as ModeloLido;

describe('jobs da plataforma (ADR 0029, ADR 0032)', () => {
  it('não há mais workflow de revogação no n8n: quem revoga é o cofre do app', () => {
    assert.equal(existsSync('n8n/workflows/plataforma/revogar-acesso.json'), false);
    assert.equal(existsSync('n8n/workflows/plataforma/revogacao'), false);
  });

  it('o job diário do YouTube chama a rota de manutenção com o token do worker', () => {
    const job = ler(WORKFLOW_DE_CONFORMIDADE_DO_YOUTUBE);
    const chamada = job.nodes.find((no) => no.type === 'n8n-nodes-base.httpRequest')!;
    assert.equal(chamada.parameters?.['url'], '=http://app:3000/api/v0/manutencao/youtube');
    assert.equal(chamada.credentials?.['httpHeaderAuth']?.name, 'ORLA · worker token');
  });

  it('a renovação proativa roda a cada 6 horas, chama a rota do cofre e cai no alerta da plataforma', () => {
    assert.ok((WORKFLOWS_DA_PLATAFORMA as readonly string[]).includes(WORKFLOW_DE_RENOVACAO_DE_TOKENS));
    const job = ler(WORKFLOW_DE_RENOVACAO_DE_TOKENS);
    assert.equal(job.name, 'ORLA · tokens · renovação');
    const gatilho = job.nodes.find((no) => no.type === 'n8n-nodes-base.scheduleTrigger')!;
    assert.match(JSON.stringify(gatilho.parameters), /\*\/6 \* \* \*/);
    const chamada = job.nodes.find((no) => no.type === 'n8n-nodes-base.httpRequest')!;
    assert.equal(chamada.parameters?.['url'], '=http://app:3000/api/v0/tokens/renovar-proativo');
    assert.equal(chamada.credentials?.['httpHeaderAuth']?.name, 'ORLA · worker token');
    assert.equal(job.settings['saveDataSuccessExecution'], 'none');
    assert.equal(job.settings['saveDataErrorExecution'], 'none');
    assert.equal(job.settings['errorWorkflow'], 'origem:n8n/workflows/plataforma/alertas-de-falha.json');
  });
});

describe('sub-workflows genéricos resolvidos pela nota de origem (ADR 0032)', () => {
  const comOrigem = (id: string, arquivo: string): Workflow & { id: string } => ({
    ...(mesclar(doRepositorio, null, `ORLA · ${id}`, arquivo).corpo as Workflow),
    id,
  });
  const chamador: Workflow = {
    ...doRepositorio,
    nodes: [
      {
        name: 'Chamar coletor',
        type: 'n8n-nodes-base.executeWorkflow',
        parameters: {
          workflowId: {
            __rl: true,
            mode: 'id',
            value: "={{ ({ ga4: 'origem:n8n/workflows/coletores/coletor-ga4.json', gtm: 'origem:n8n/workflows/coletores/coletor-gtm.json' })[$json.platform] }}",
          },
        },
      },
    ],
  };

  it('troca cada origem pelo id implantado, dentro da expressão', () => {
    const implantados = [comOrigem('wfGa4', 'n8n/workflows/coletores/coletor-ga4.json'), comOrigem('wfGtm', 'n8n/workflows/coletores/coletor-gtm.json')];
    const { modelo, pendencias } = resolverSubWorkflows(chamador, implantados);
    assert.deepEqual(pendencias, []);
    assert.equal(
      (modelo.nodes[0]!.parameters!['workflowId'] as { value: string }).value,
      "={{ ({ ga4: 'wfGa4', gtm: 'wfGtm' })[$json.platform] }}",
    );
  });

  it('genérico ainda não implantado vira pendência e bloqueia', () => {
    const { pendencias } = resolverSubWorkflows(chamador, [comOrigem('wfGa4', 'n8n/workflows/coletores/coletor-ga4.json')]);
    assert.deepEqual(pendencias, ['Chamar coletor: sub-workflow n8n/workflows/coletores/coletor-gtm.json ainda não implantado']);
  });

  it('dois workflows com a mesma origem (cópia por conexão antiga) recusam a resolução', () => {
    const duplicados = [comOrigem('a', 'n8n/workflows/coletores/coletor-ga4.json'), comOrigem('b', 'n8n/workflows/coletores/coletor-ga4.json')];
    assert.throws(() => resolverSubWorkflows(chamador, duplicados), /mais de um/);
  });

  it('o orquestrador, a janela do backfill e as tarefas de conta só chamam genéricos por origem, nunca por ref da conexão', () => {
    for (const arquivo of ['n8n/workflows/coleta-orquestrador.json', 'n8n/workflows/coleta-backfill-janela.json', 'n8n/workflows/tarefas-de-conta.json']) {
      const texto = readFileSync(arquivo, 'utf8');
      assert.ok(!/coletorRef|executorRef|credentialRef/.test(texto), arquivo);
    }
    const orquestrador = ler('n8n/workflows/coleta-orquestrador.json');
    const chamar = orquestrador.nodes.find((no) => no.name === 'Chamar coletor')!;
    const valor = String((chamar.parameters?.['workflowId'] as { value: string }).value);
    for (const [plataforma, arquivo] of Object.entries(COLETOR_DA_PLATAFORMA)) assert.ok(valor.includes(`${plataforma}: 'origem:${arquivo}'`), plataforma);

    const tarefas = ler('n8n/workflows/tarefas-de-conta.json');
    const executar = tarefas.nodes.find((no) => no.name === 'Executar tarefa')!;
    const doExecutor = String((executar.parameters?.['workflowId'] as { value: string }).value);
    for (const [plataforma, arquivo] of Object.entries(EXECUTOR_DA_PLATAFORMA)) assert.ok(doExecutor.includes(`${plataforma}: 'origem:${arquivo}'`), plataforma);
  });
});

describe('criar workflow da plataforma que ainda não foi implantado', () => {
  const implantados: Workflow[] = [
    { name: 'A', connections: {}, settings: {}, nodes: [{ name: 'x', type: 't', credentials: { httpHeaderAuth: { id: 'cred-worker', name: 'ORLA · worker token' } } }] },
    { name: 'B', connections: {}, settings: {}, nodes: [{ name: 'y', type: 't', credentials: { httpHeaderAuth: { id: 'cred-zapi', name: 'ORLA · Z-API' } } }] },
    { name: 'C', connections: {}, settings: {}, nodes: [{ name: 'z', type: 't', credentials: { httpHeaderAuth: { id: 'cred-z2', name: 'ORLA · Z-API' } } }] },
  ];

  it('liga a credencial pelo tipo e nome, e não liga nome ambíguo', () => {
    const conhecidas = credenciaisPorNome(implantados);
    assert.equal(conhecidas.get('httpHeaderAuth|ORLA · worker token')?.id, 'cred-worker');
    assert.equal(conhecidas.has('httpHeaderAuth|ORLA · Z-API'), false);

    const modelo: Workflow = {
      name: 'novo',
      connections: {},
      settings: {},
      nodes: [
        { name: 'g', type: 't', credentials: { httpHeaderAuth: { id: 'a-definir-pelo-provisioner', name: 'ORLA · worker token' } } },
        { name: 'h', type: 't', credentials: { httpHeaderAuth: { id: 'a-definir-pelo-provisioner', name: 'ORLA · Z-API' } } },
      ],
    };
    const ligado = modeloComCredenciaisPorNome(modelo, conhecidas);
    assert.equal(ligado.nodes[0]!.credentials!['httpHeaderAuth']!.id, 'cred-worker');
    assert.equal(ligado.nodes[1]!.credentials!['httpHeaderAuth']!.id, 'a-definir-pelo-provisioner');
    assert.deepEqual(mesclar(ligado, null, 'novo', 'arq.json').pendencias, ['h: credencial httpHeaderAuth sem vínculo']);
  });
});
