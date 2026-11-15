import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { credentialIdOf } from '@/modules/connections/application/credentialVault';
import { CREDENTIAL_TYPE } from '@/modules/connections/infrastructure/n8nCredentialVault';
import type { Platform } from '@/modules/connections/domain/connection';
import coletorGoogleAds from '@/../n8n/workflows/coletores/coletor-google-ads.json';

type WorkflowTemplate = {
  readonly name: string;
  readonly settings: Record<string, unknown>;
  readonly nodes: readonly Record<string, unknown>[];
  readonly connections: Record<string, unknown>;
};

const TEMPLATE_BY_PLATFORM: Partial<Record<Platform, WorkflowTemplate>> = {
  google: coletorGoogleAds as WorkflowTemplate,
};

const CREDENTIAL_ID_TOKEN = '__CREDENCIAL_ID__';
const CREDENTIAL_NOME_TOKEN = '__CREDENCIAL_NOME__';

export type ColetorProvisioner = {
  readonly available: boolean;
  provisionar(input: { readonly platform: Platform; readonly credentialRef: string; readonly label: string }): Promise<string | null>;
};

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

      const credentialNome = `ORLA · coletor · ${input.label}`;
      const texto = JSON.stringify(template).replaceAll(CREDENTIAL_ID_TOKEN, credentialId).replaceAll(CREDENTIAL_NOME_TOKEN, credentialNome);
      const corpo = JSON.parse(texto) as WorkflowTemplate;

      const tipoEsperado = CREDENTIAL_TYPE[input.platform];
      const temCredencialCerta = corpo.nodes.some((node) =>
        Object.keys((node['credentials'] as Record<string, unknown>) ?? {}).includes(tipoEsperado),
      );
      if (!temCredencialCerta) {
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
