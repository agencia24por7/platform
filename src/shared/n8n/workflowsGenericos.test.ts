import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { COLETOR_DA_PLATAFORMA, EXECUTOR_DA_PLATAFORMA, ROTA_DO_TOKEN, nomeDoColetor, nomeDoExecutor } from './modelos.ts';

type Credenciais = Record<string, { id: string; name: string }>;
type No = {
  name: string;
  type: string;
  parameters: Record<string, unknown> & { jsCode?: string; url?: string };
  credentials?: Credenciais;
};
type Workflow = { name: string; nodes: No[]; connections: Record<string, { main: { node: string }[][] }>; settings: Record<string, unknown> };
type Item = { json: Record<string, unknown> };

const ler = (caminho: string) => JSON.parse(readFileSync(caminho, 'utf8')) as Workflow;
const AUTORIZACAO = "={{ 'Bearer ' + $('Obter token').first().json.body.token }}";
const TOKEN_NA_QUERY = "={{ $('Obter token').first().json.body.token }}";
const COM_TOKEN_DA_PAGINA = new Set(['Listar formulários', 'Leads do formulário']);

const parametros = (no: No, chave: 'headerParameters' | 'queryParameters') =>
  ((no.parameters[chave] as { parameters?: { name: string; value: string }[] } | undefined)?.parameters ?? []);

function executar(workflow: Workflow, nome: string, nos: Record<string, Item[]>): Item[] {
  const codigo = workflow.nodes.find((no) => no.name === nome)!.parameters.jsCode!;
  const referenciar = (outro: string) => ({ all: () => nos[outro]!, first: () => nos[outro]![0]!, item: nos[outro]?.[0] });
  const corpo = new Function('$input', '$json', '$', codigo) as (...argumentos: unknown[]) => Item[];
  return corpo({ all: () => [], first: () => undefined }, undefined, referenciar);
}

const genericos = [
  ...Object.entries(COLETOR_DA_PLATAFORMA).map(([plataforma, arquivo]) => ({ plataforma, arquivo, tipo: 'coletor' as const })),
  ...Object.entries(EXECUTOR_DA_PLATAFORMA).map(([plataforma, arquivo]) => ({ plataforma, arquivo, tipo: 'executor' as const })),
];

for (const { plataforma, arquivo, tipo } of genericos) {
  describe(`${tipo} genérico ${plataforma} (ADR 0032)`, () => {
    const workflow = ler(arquivo);
    const no = (nome: string) => workflow.nodes.find((candidato) => candidato.name === nome)!;
    const daApi = workflow.nodes.filter((candidato) => candidato.type === 'n8n-nodes-base.httpRequest' && candidato.name !== 'Obter token');

    it('tem nome de plataforma, não guarda execução e só aceita chamada do mesmo dono', () => {
      assert.equal(workflow.name, tipo === 'coletor' ? nomeDoColetor(plataforma) : nomeDoExecutor(plataforma));
      assert.equal(workflow.settings['saveDataSuccessExecution'], 'none');
      assert.equal(workflow.settings['saveDataErrorExecution'], 'none');
      assert.equal(workflow.settings['saveManualExecutions'], false);
      assert.equal(workflow.settings['callerPolicy'], 'workflowsFromSameOwner');
    });

    it('nenhum nó tem credencial por conexão: o único bloco credentials é o worker token do app', () => {
      const comCredencial = workflow.nodes.filter((candidato) => candidato.credentials);
      assert.deepEqual(comCredencial.map((candidato) => candidato.name), ['Obter token']);
      assert.deepEqual(Object.keys(no('Obter token').credentials!), ['httpHeaderAuth']);
      assert.equal(no('Obter token').credentials!['httpHeaderAuth']!.name, 'ORLA · worker token');
      assert.ok(!/a-definir-pelo-provisioner[^"]*"\s*,\s*"name":\s*"a-definir/.test(JSON.stringify(workflow)));
      for (const candidato of workflow.nodes) {
        assert.ok(!['googleOAuth2Api', 'facebookGraphApi', 'httpQueryAuth'].includes(String(candidato.parameters['nodeCredentialType'] ?? candidato.parameters['genericAuthType'])), candidato.name);
      }
    });

    it('primeiro pede o token ao app com o id da origem e só segue se ele veio', () => {
      assert.equal(workflow.connections['Entrada']!.main[0]![0]!.node, 'Obter token');
      const obter = no('Obter token');
      assert.equal(obter.parameters.url, `=${ROTA_DO_TOKEN}`);
      assert.equal(obter.parameters['method'], 'POST');
      assert.match(String(obter.parameters['jsonBody']), tipo === 'coletor' ? /coletaId/ : /tarefaId/);
      assert.equal(workflow.connections['Obter token']!.main[0]![0]!.node, 'Token obtido?');
      assert.equal(workflow.connections['Token obtido?']!.main[0]![0]!.node, 'Retomar entrada');
      assert.equal(workflow.connections['Token obtido?']!.main[1]![0]!.node, 'Sem token');
      const entradas = (no('Entrada').parameters['workflowInputs'] as { values: { name: string }[] }).values.map((valor) => valor.name);
      assert.ok(entradas.includes(tipo === 'coletor' ? 'coletaId' : 'tarefaId'));
    });

    it('todo nó HTTP que fala com o provedor leva o token do cofre (Bearer, ou query no RD)', () => {
      assert.ok(daApi.length > 0);
      for (const chamada of daApi) {
        assert.ok(!String(chamada.parameters.url).includes('app:3000'), chamada.name);
        if (COM_TOKEN_DA_PAGINA.has(chamada.name)) {
          assert.ok(parametros(chamada, 'queryParameters').some((p) => p.name === 'access_token' && p.value.includes("$('Token da Página')")), chamada.name);
          continue;
        }
        assert.equal(chamada.parameters['authentication'], 'none', chamada.name);
        if (plataforma === 'rdstation') {
          assert.equal(parametros(chamada, 'queryParameters').find((p) => p.name === 'token')?.value, TOKEN_NA_QUERY, chamada.name);
        } else {
          assert.equal(parametros(chamada, 'headerParameters').find((p) => p.name === 'Authorization')?.value, AUTORIZACAO, chamada.name);
        }
      }
    });

    it('o primeiro nó da lógica recebe exatamente os itens da Entrada', () => {
      const retomar = executar(workflow, 'Retomar entrada', { Entrada: [{ json: { fonte: { externalId: 'x' }, janela: { start: 'a', end: 'b' } } }] });
      assert.deepEqual(retomar, [{ json: { fonte: { externalId: 'x' }, janela: { start: 'a', end: 'b' } } }]);
    });

    if (plataforma === 'google') {
      it('o Google Ads continua mandando o login-customer-id da administradora', () => {
        for (const chamada of daApi) assert.ok(parametros(chamada, 'headerParameters').some((p) => p.name === 'login-customer-id'), chamada.name);
      });
    }

    const recusa = (statusCode: number, motivo?: string) => ({
      'Obter token': [{ json: { statusCode, body: motivo ? { errors: { motivo } } : { title: 'erro' } } }],
      Entrada: [{ json: { tarefa: { taskId: 't-1' } } }],
    });

    if (tipo === 'coletor') {
      it('sem token: reauth_pending para conexão a reautorizar, limite_de_uso no 429 e transitória no 503', () => {
        const causa = (nos: Record<string, Item[]>) => (executar(workflow, 'Sem token', nos)[0]!.json.falhas as { causa: string }[])[0]!;
        for (const motivo of ['reauth_pending', 'sem_token', 'conexao_revogada']) assert.equal(causa(recusa(409, motivo)).causa, 'reauth_pending');
        assert.deepEqual(
          (({ causa: c, pausa, minutos }) => ({ c, pausa, minutos }))(causa(recusa(429)) as unknown as { causa: string; pausa: string; minutos: number }),
          { c: 'limite_de_uso', pausa: 'limite_temporario', minutos: 5 },
        );
        assert.equal(causa(recusa(503)).causa, 'api_recusou');
        assert.equal(causa(recusa(0)).causa, 'api_recusou');
        assert.equal(causa(recusa(409, 'origem_encerrada')).causa, 'falha_coletor');
        const saida = executar(workflow, 'Sem token', recusa(409, 'reauth_pending'))[0]!.json;
        assert.deepEqual(saida.linhas, []);
        assert.equal((saida.volumetria as { requests: number }).requests, 0);
      });
    } else {
      it('sem token: a tarefa falha com reauth_pending e o id da tarefa', () => {
        const saida = executar(workflow, 'Sem token', recusa(409, 'reauth_pending'))[0]!.json;
        assert.equal(saida.taskId, 't-1');
        assert.equal(saida.sucesso, false);
        assert.match(String(saida.outcome), /^reauth_pending/);
      });
    }
  });
}

describe('orquestração dos genéricos', () => {
  it('o orquestrador só chama coletor para fonte com token e passa o id da coleta', () => {
    for (const arquivo of ['n8n/workflows/coleta-orquestrador.json', 'n8n/workflows/coleta-backfill-janela.json']) {
      const workflow = ler(arquivo);
      const se = workflow.nodes.find((no) => no.name === 'Tem token?')!;
      assert.match(JSON.stringify(se.parameters), /temToken === true/);
      const chamar = workflow.nodes.find((no) => no.name === 'Chamar coletor')!;
      const entradas = (chamar.parameters['workflowInputs'] as { value: Record<string, string> }).value;
      assert.equal(entradas['coletaId'], "={{ $('Abrir execução').item.json.id }}");
    }
  });

  it('as tarefas de conta chamam o executor da plataforma com o id da tarefa e caem em reauth_pending sem token', () => {
    const workflow = ler('n8n/workflows/tarefas-de-conta.json');
    const executar = workflow.nodes.find((no) => no.name === 'Executar tarefa')!;
    assert.equal((executar.parameters['workflowInputs'] as { value: Record<string, string> }).value['tarefaId'], '={{ $json.taskId }}');
    const sem = workflow.nodes.find((no) => no.name === 'Sem token')!;
    const corpo = new Function('$json', sem.parameters.jsCode!) as ($json: unknown) => Item;
    assert.match(String(corpo({ taskId: 't', temToken: false, platform: 'google' }).json.outcome), /^reauth_pending/);
  });
});
