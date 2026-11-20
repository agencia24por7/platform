import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { clienteN8nDoAmbiente, n8nDisponivel, type WorkflowTemplate } from '@/shared/n8n/workflowComCredencial';
import revogarGoogle from '@/../n8n/workflows/plataforma/revogacao/revogar-google.json';
import revogarMeta from '@/../n8n/workflows/plataforma/revogacao/revogar-meta.json';
import type { ExecutorDeRevogacao } from '@/modules/privacidade/application/revogacaoNoProvedor';
import { createExecutorDeRevogacaoN8n } from '@/modules/privacidade/infrastructure/executorDeRevogacaoN8n';

export function executorDeRevogacaoDoAmbiente(): ExecutorDeRevogacao {
  const config = env();
  const disponivel = n8nDisponivel();
  return createExecutorDeRevogacaoN8n({
    disponivel,
    modelos: { google: revogarGoogle as WorkflowTemplate, meta: revogarMeta as WorkflowTemplate },
    workflows: {
      criar: (corpo, contexto) => clienteN8nDoAmbiente().criar(corpo, contexto),
      remover: (workflowId, contexto) => clienteN8nDoAmbiente().remover(workflowId, contexto),
    },
    urlDoN8n: config.N8N_API_URL ?? 'http://127.0.0.1:5678',
    tokenDoWorker: config.TRIA_WORKER_TOKEN,
    chamar: fetch,
    logger,
  });
}
