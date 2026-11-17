import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';

type WorkflowNode = {
  readonly credentials?: Record<string, { id: string; name: string }>;
  readonly [key: string]: unknown;
};

export type WorkflowTemplate = {
  name: string;
  readonly settings: Record<string, unknown>;
  readonly nodes: readonly WorkflowNode[];
  readonly connections: Record<string, unknown>;
};

export function n8nDisponivel(): boolean {
  const config = env();
  return Boolean(config.N8N_API_URL && config.N8N_API_KEY);
}

export function montarWorkflow(
  template: WorkflowTemplate,
  tipoDeCredencial: string,
  credentialId: string,
  nome: string,
): WorkflowTemplate | null {
  const corpo = structuredClone(template);
  corpo.name = nome;

  let encontrada = false;
  for (const node of corpo.nodes) {
    if (!node.credentials || !(tipoDeCredencial in node.credentials)) continue;
    node.credentials[tipoDeCredencial] = { id: credentialId, name: nome };
    encontrada = true;
  }

  return encontrada ? corpo : null;
}

export async function criarWorkflow(corpo: WorkflowTemplate, contexto: Record<string, string>): Promise<string | null> {
  const config = env();
  try {
    const response = await fetch(new URL('/api/v1/workflows', config.N8N_API_URL).toString(), {
      method: 'POST',
      headers: { 'X-N8N-API-KEY': config.N8N_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.error('n8n.workflow.criar.falhou', { ...contexto, status: response.status });
      return null;
    }

    const criado = (await response.json()) as { id?: string };
    if (!criado.id) return null;

    logger.info('n8n.workflow.criar.ok', { ...contexto, workflowId: criado.id });
    return criado.id;
  } catch (error) {
    logger.error('n8n.workflow.criar.erro', { ...contexto, error: error instanceof Error ? error.message : 'desconhecido' });
    return null;
  }
}
