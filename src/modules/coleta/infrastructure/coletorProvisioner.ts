import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { credentialIdOf } from '@/modules/connections/application/credentialVault';
import { CREDENTIAL_TYPE } from '@/modules/connections/infrastructure/n8nCredentialVault';
import type { Platform } from '@/modules/connections/domain/connection';
import coletorGoogleAds from '@/../n8n/workflows/coletores/coletor-google-ads.json';

type WorkflowNode = {
  readonly credentials?: Record<string, { id: string; name: string }>;
  readonly [key: string]: unknown;
};

type WorkflowTemplate = {
  name: string;
  readonly settings: Record<string, unknown>;
  readonly nodes: readonly WorkflowNode[];
  readonly connections: Record<string, unknown>;
};

const TEMPLATE_BY_PLATFORM: Partial<Record<Platform, WorkflowTemplate>> = {
  google: coletorGoogleAds as WorkflowTemplate,
};

export type ColetorProvisioner = {
  readonly available: boolean;
  provisionar(input: { readonly platform: Platform; readonly credentialRef: string; readonly label: string }): Promise<string | null>;
};

function montarWorkflow(template: WorkflowTemplate, tipoEsperado: string, credentialId: string, credentialNome: string): WorkflowTemplate | null {
  const corpo = structuredClone(template);
  corpo.name = `Coletor · ${credentialNome}`;

  let encontrada = false;
  for (const node of corpo.nodes) {
    if (!node.credentials || !(tipoEsperado in node.credentials)) continue;
    node.credentials[tipoEsperado] = { id: credentialId, name: credentialNome };
    encontrada = true;
  }

  return encontrada ? corpo : null;
}

export function createColetorProvisioner(): ColetorProvisioner {
  const config = env();
  const available = Boolean(config.N8N_API_URL && config.N8N_API_KEY);

  return {
    available,

    async provisionar(input) {
      if (!available) return null;

      const template = TEMPLATE_BY_PLATFORM[input.platform];
      if (!template) return null;

      const credentialId = credentialIdOf(input.credentialRef);
      if (!credentialId) return null;

      const corpo = montarWorkflow(template, CREDENTIAL_TYPE[input.platform], credentialId, `ORLA · coletor · ${input.label}`);
      if (!corpo) {
        logger.error('coletor.provisionar.template_sem_credencial', { platform: input.platform });
        return null;
      }

      try {
        const response = await fetch(new URL('/api/v1/workflows', config.N8N_API_URL).toString(), {
          method: 'POST',
          headers: { 'X-N8N-API-KEY': config.N8N_API_KEY!, 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
          logger.error('coletor.provisionar.falhou', { platform: input.platform, status: response.status });
          return null;
        }

        const criado = (await response.json()) as { id?: string };
        if (!criado.id) return null;

        logger.info('coletor.provisionar.ok', { platform: input.platform, workflowId: criado.id });
        return criado.id;
      } catch (error) {
        logger.error('coletor.provisionar.erro', { platform: input.platform, error: error instanceof Error ? error.message : 'desconhecido' });
        return null;
      }
    },
  };
}
