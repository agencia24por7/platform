import { logger } from '@/shared/logging/logger';
import { criarWorkflow, montarWorkflow, n8nDisponivel, type WorkflowTemplate } from '@/shared/n8n/workflowComCredencial';
import { credentialIdOf } from '@/modules/connections/application/credentialVault';
import { CREDENTIAL_TYPE } from '@/modules/connections/infrastructure/n8nCredentialVault';
import type { Platform } from '@/modules/connections/domain/connection';
import executorMcc from '@/../n8n/workflows/executores/executor-mcc.json';
import executorMetaPartner from '@/../n8n/workflows/executores/executor-meta-partner.json';

const TEMPLATE_BY_PLATFORM: Partial<Record<Platform, WorkflowTemplate>> = {
  google: executorMcc as WorkflowTemplate,
  meta: executorMetaPartner as WorkflowTemplate,
};

export type ExecutorProvisioner = {
  readonly available: boolean;
  provisionar(input: { readonly platform: Platform; readonly credentialRef: string; readonly label: string }): Promise<string | null>;
};

export function createExecutorProvisioner(): ExecutorProvisioner {
  const available = n8nDisponivel();

  return {
    available,

    async provisionar(input) {
      if (!available) return null;

      const template = TEMPLATE_BY_PLATFORM[input.platform];
      if (!template) return null;

      const credentialId = credentialIdOf(input.credentialRef);
      if (!credentialId) return null;

      const corpo = montarWorkflow(template, CREDENTIAL_TYPE[input.platform], credentialId, `Executor · ORLA · tarefas · ${input.label}`);
      if (!corpo) {
        logger.error('executor.provisionar.template_sem_credencial', { platform: input.platform });
        return null;
      }

      return criarWorkflow(corpo, { tipo: 'executor', platform: input.platform });
    },
  };
}
