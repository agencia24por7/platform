import type { Registrador } from '@/shared/n8n/clienteN8n';
import { montarWorkflow, type WorkflowTemplate } from '@/shared/n8n/workflowComCredencial';
import { WEBHOOK_DE_REVOGACAO } from '@/shared/n8n/modelos';
import type { DesfechoDoExecutor, ExecutorDeRevogacao } from '@/modules/privacidade/application/revogacaoNoProvedor';
import type { ProvedorRevogavel } from '@/modules/privacidade/domain/revogacao';

export const TIPO_DE_CREDENCIAL: Readonly<Record<ProvedorRevogavel, string>> = {
  google: 'googleOAuth2Api',
  meta: 'facebookGraphApi',
};

export const TEMPO_MAXIMO_DA_REVOGACAO_MS = 20_000;

type ClienteDeWorkflows = {
  criar(corpo: WorkflowTemplate, contexto: Record<string, string>): Promise<string | null>;
  remover(workflowId: string, contexto: Record<string, string>): Promise<boolean>;
};

export type DependenciasDoExecutor = {
  readonly disponivel: boolean;
  readonly modelos: Readonly<Record<ProvedorRevogavel, WorkflowTemplate>>;
  readonly workflows: ClienteDeWorkflows;
  readonly urlDoN8n: string;
  readonly tokenDoWorker: string;
  readonly chamar: typeof fetch;
  readonly logger: Registrador;
};

export function createExecutorDeRevogacaoN8n(deps: DependenciasDoExecutor): ExecutorDeRevogacao {
  async function pedirRevogacao(workflowId: string, connectionId: string): Promise<DesfechoDoExecutor> {
    const resposta = await deps.chamar(new URL(`/webhook/${WEBHOOK_DE_REVOGACAO}`, deps.urlDoN8n).toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${deps.tokenDoWorker}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId, connectionId }),
      signal: AbortSignal.timeout(TEMPO_MAXIMO_DA_REVOGACAO_MS),
    });
    if (!resposta.ok) {
      deps.logger.warn('revogacao.n8n.resposta', { connectionId, status: resposta.status });
      return 'falhou';
    }
    const corpo = (await resposta.json().catch(() => null)) as { revogado?: unknown } | null;
    return corpo?.revogado === true ? 'revogado' : 'recusado';
  }

  return {
    disponivel: deps.disponivel,

    async executar({ provedor, credentialId, connectionId }) {
      const corpo = montarWorkflow(deps.modelos[provedor], TIPO_DE_CREDENCIAL[provedor], credentialId, `ORLA · revogação · ${connectionId}`);
      if (!corpo) {
        deps.logger.error('revogacao.modelo_sem_credencial', { provedor });
        return 'falhou';
      }

      const contexto = { tipo: 'revogacao', provedor, connectionId };
      const workflowId = await deps.workflows.criar(corpo, contexto);
      if (!workflowId) return 'falhou';

      try {
        return await pedirRevogacao(workflowId, connectionId);
      } catch (erro) {
        deps.logger.warn('revogacao.n8n.erro', { connectionId, error: erro instanceof Error ? erro.message : 'desconhecido' });
        return 'falhou';
      } finally {
        const removido = await deps.workflows.remover(workflowId, contexto).catch(() => false);
        if (!removido) deps.logger.warn('revogacao.workflow_temporario_orfao', { connectionId, workflowId });
      }
    },
  };
}
