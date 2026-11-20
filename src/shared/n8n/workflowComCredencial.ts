import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { criarClienteN8n, type ClienteN8n } from '@/shared/n8n/clienteN8n';

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

export function clienteN8nDoAmbiente(): ClienteN8n {
  const config = env();
  return criarClienteN8n({ url: config.N8N_API_URL!, apiKey: config.N8N_API_KEY! }, logger);
}

export async function criarWorkflow(corpo: WorkflowTemplate, contexto: Record<string, string>): Promise<string | null> {
  return clienteN8nDoAmbiente().criar(corpo, contexto);
}

export async function removerWorkflow(workflowId: string, contexto: Record<string, string>): Promise<boolean> {
  return clienteN8nDoAmbiente().remover(workflowId, contexto);
}
