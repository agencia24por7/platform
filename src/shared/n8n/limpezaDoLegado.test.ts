import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowImplantado } from './clienteN8n.ts';
import { executarLimpeza, idDaCredencial, planejarLimpeza, type ClienteDaLimpeza, type RefsDoCorte } from './limpezaDoLegado.ts';

const GENERICOS = new Set(['ORLA · Google Analytics · coletor', 'ORLA · coleta · orquestrador']);

function workflow(id: string, name: string, tags: string[], credenciais: Record<string, { id: string; name: string }> = {}): WorkflowImplantado {
  return {
    id,
    name,
    active: true,
    tags: tags.map((tag, indice) => ({ id: `t${indice}`, name: tag })),
    connections: {},
    settings: {},
    nodes: [{ name: 'Chamar API', type: 'n8n-nodes-base.httpRequest', credentials: credenciais }],
  };
}

function clienteFalso(iniciais: WorkflowImplantado[], opcoes: { falharWorkflow?: string; falharCredencial?: string } = {}) {
  let workflows = [...iniciais];
  const credenciais = new Set(['cred1', 'cred2', 'cred3', 'credWorker', 'credCredaz']);
  const chamadas: string[] = [];
  const cliente: ClienteDaLimpeza = {
    async listar() {
      chamadas.push('listar');
      return workflows;
    },
    async remover(id) {
      chamadas.push(`remover:${id}`);
      if (id === opcoes.falharWorkflow) return false;
      workflows = workflows.filter((w) => w.id !== id);
      return true;
    },
    async removerCredencial(id) {
      chamadas.push(`credencial:${id}`);
      if (id === opcoes.falharCredencial) return 'falhou';
      return credenciais.delete(id) ? 'removida' : 'ausente';
    },
  };
  return { cliente, chamadas, workflows: () => workflows, credenciais };
}

const ref = (connectionId: string, campos: Partial<RefsDoCorte>): RefsDoCorte => ({
  connectionId,
  platform: 'ga4',
  credentialRef: null,
  coletorRef: null,
  executorRef: null,
  ...campos,
});

describe('limpeza do legado do n8n (ADR 0032)', () => {
  const legado = [
    workflow('wf1', 'Coletor · ORLA · coletor · GA4 · Agência', ['platform'], { googleOAuth2Api: { id: 'cred1', name: 'Coletor · ORLA · coletor · GA4 · Agência' } }),
    workflow('wf2', 'Executor · ORLA · tarefas · Google Ads · Agência', ['platform'], { googleOAuth2Api: { id: 'cred2', name: 'x' } }),
    workflow('wf3', 'Coletor · ORLA · coletor · Meta · Credaz', ['platform', 'credaz'], { facebookGraphApi: { id: 'cred3', name: 'y' } }),
    workflow('wf4', 'Coletor · ORLA · coletor · sem tag', []),
    workflow('wf5', 'ORLA · Google Analytics · coletor', ['platform'], { httpHeaderAuth: { id: 'credWorker', name: 'ORLA · worker token' } }),
    workflow('wf6', 'Fluxo da agência', ['agencia'], { httpHeaderAuth: { id: 'credCredaz', name: 'Credaz · RD' } }),
    workflow('wf7', 'Nome qualquer sem marca', []),
  ];
  const refs = [
    ref('c1', { credentialRef: 'n8n:credential:cred1', coletorRef: 'wf1', executorRef: 'wf2' }),
    ref('c2', { credentialRef: 'n8n:credential:cred3', coletorRef: 'wf3' }),
    ref('c3', { coletorRef: 'wfSumido', credentialRef: 'n8n:credential:credSumida' }),
    ref('c4', { coletorRef: 'wf7' }),
    ref('c5', { credentialRef: 'n8n:credential:credWorker' }),
    ref('c6', { credentialRef: 'n8n:credential:credCredaz', coletorRef: 'wf5' }),
    ref('c7', { credentialRef: 'pendente:cofre-indisponivel' }),
    ref('c8', { credentialRef: 'n8n:credential:../../x' }),
  ];

  it('extrai o id da credencial só de n8n:credential:{id} válido', () => {
    assert.equal(idDaCredencial('n8n:credential:AbC123'), 'AbC123');
    assert.equal(idDaCredencial('n8n:credential:../x'), null);
    assert.equal(idDaCredencial('pendente:cofre-indisponivel'), null);
  });

  it('dry-run por padrão: planeja, não remove nada e explica cada recusa', async () => {
    const falso = clienteFalso(legado);
    const relatorio = await executarLimpeza(refs, falso.cliente, GENERICOS, false);

    assert.equal(relatorio.aplicado, false);
    assert.deepEqual(falso.chamadas, ['listar']);
    assert.deepEqual(relatorio.planejados.map((item) => `${item.tipo}:${item.id}`).sort(), ['credencial:cred1', 'credencial:credSumida', 'workflow:wf1', 'workflow:wf2']);

    const motivo = (id: string) => relatorio.ignorados.find((item) => item.id === id)?.motivo;
    assert.equal(motivo('wf3'), 'intocavel');
    assert.equal(motivo('cred3'), 'credencial_em_uso');
    assert.equal(motivo('wf4'), 'sem_identificacao_da_plataforma');
    assert.equal(motivo('wf7'), 'sem_identificacao_da_plataforma');
    assert.equal(motivo('wf5'), 'generico_da_plataforma');
    assert.equal(motivo('credWorker'), 'credencial_compartilhada_da_plataforma');
    assert.equal(motivo('credCredaz'), 'credencial_em_uso');
    assert.equal(motivo('n8n:credential:../../x'), 'referencia_invalida');
    assert.ok(relatorio.jaAusentes.some((item) => item.id === 'wfSumido'));
    assert.equal(relatorio.conexoesLimpas.includes('c1'), false, 'no dry-run nada fica limpo');
    assert.ok(relatorio.conexoesLimpas.includes('c7'), 'sem nada no n8n a conexão já está limpa');
  });

  it('--aplicar remove workflows antes das credenciais, nunca toca credaz/agência/genéricos e é idempotente', async () => {
    const falso = clienteFalso(legado);
    const relatorio = await executarLimpeza(refs, falso.cliente, GENERICOS, true);

    assert.deepEqual(relatorio.removidos.map((item) => item.id).sort(), ['cred1', 'wf1', 'wf2']);
    assert.ok(relatorio.jaAusentes.some((item) => item.id === 'credSumida'));
    const ordem = falso.chamadas.filter((chamada) => chamada !== 'listar');
    assert.ok(ordem.indexOf('remover:wf1') < ordem.indexOf('credencial:cred1'));
    assert.ok(!falso.chamadas.some((chamada) => /wf3|wf4|wf5|wf6|wf7|cred3|credWorker|credCredaz/.test(chamada)));
    assert.deepEqual(falso.workflows().map((w) => w.id).sort(), ['wf3', 'wf4', 'wf5', 'wf6', 'wf7']);
    assert.ok(falso.credenciais.has('credWorker'));
    assert.deepEqual([...relatorio.conexoesLimpas].sort(), ['c1', 'c3', 'c7']);
    assert.equal(relatorio.contagem.falhas, 0);

    const deNovo = await executarLimpeza(refs, falso.cliente, GENERICOS, true);
    assert.equal(deNovo.contagem.removidos, 0);
    assert.equal(deNovo.contagem.falhas, 0);
    assert.ok(deNovo.jaAusentes.some((item) => item.id === 'wf1'));
  });

  it('rede de segurança: remove por nome só com a tag platform, mesmo sem ref no corte', () => {
    const plano = planejarLimpeza([], legado, GENERICOS);
    assert.deepEqual(plano.workflows.map((item) => item.id).sort(), ['wf1', 'wf2']);
    assert.ok(plano.ignorados.some((item) => item.id === 'wf4' && item.motivo === 'sem_identificacao_da_plataforma'));
    assert.ok(plano.ignorados.some((item) => item.id === 'wf3' && item.motivo === 'intocavel'));
  });

  it('workflow que falhou ao remover segura a credencial dele e a conexão não fica limpa', async () => {
    const falso = clienteFalso(legado, { falharWorkflow: 'wf1' });
    const relatorio = await executarLimpeza(refs, falso.cliente, GENERICOS, true);
    assert.ok(relatorio.falhas.some((item) => item.id === 'wf1'));
    assert.ok(relatorio.ignorados.some((item) => item.id === 'cred1' && item.motivo === 'workflow_ainda_existe'));
    assert.ok(!falso.chamadas.includes('credencial:cred1'));
    assert.equal(relatorio.conexoesLimpas.includes('c1'), false);
  });

  it('falha ao remover a credencial entra no relatório como falha', async () => {
    const falso = clienteFalso(legado, { falharCredencial: 'cred1' });
    const relatorio = await executarLimpeza(refs, falso.cliente, GENERICOS, true);
    assert.ok(relatorio.falhas.some((item) => item.id === 'cred1'));
    assert.equal(relatorio.conexoesLimpas.includes('c1'), false);
  });

  it('o relatório não carrega segredo, só ids e nomes', async () => {
    const relatorio = await executarLimpeza(refs, clienteFalso(legado).cliente, GENERICOS, false);
    assert.ok(!/token=|Bearer |access_token/.test(JSON.stringify(relatorio)));
  });
});
