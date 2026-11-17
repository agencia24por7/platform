import { logger } from '@/shared/logging/logger';
import { criarWorkflow, montarWorkflow, n8nDisponivel, type WorkflowTemplate } from '@/shared/n8n/workflowComCredencial';
import { credentialIdOf } from '@/modules/connections/application/credentialVault';
import { CREDENTIAL_TYPE } from '@/modules/connections/infrastructure/n8nCredentialVault';
import type { Platform } from '@/modules/connections/domain/connection';
import coletorGoogleAds from '@/../n8n/workflows/coletores/coletor-google-ads.json';
import coletorSearchConsole from '@/../n8n/workflows/coletores/coletor-searchconsole.json';
import coletorYoutube from '@/../n8n/workflows/coletores/coletor-youtube.json';
import coletorGbp from '@/../n8n/workflows/coletores/coletor-gbp.json';
import coletorGa4 from '@/../n8n/workflows/coletores/coletor-ga4.json';
import coletorMeta from '@/../n8n/workflows/coletores/coletor-meta-insights.json';
import coletorGtm from '@/../n8n/workflows/coletores/coletor-gtm.json';

const TEMPLATE_BY_PLATFORM: Partial<Record<Platform, WorkflowTemplate>> = {
  google: coletorGoogleAds as WorkflowTemplate,
  searchconsole: coletorSearchConsole as WorkflowTemplate,
  youtube: coletorYoutube as WorkflowTemplate,
  gbp: coletorGbp as WorkflowTemplate,
  ga4: coletorGa4 as WorkflowTemplate,
  meta: coletorMeta as WorkflowTemplate,
  gtm: coletorGtm as WorkflowTemplate,
};

export type ColetorProvisioner = {
  readonly available: boolean;
  provisionar(input: { readonly platform: Platform; readonly credentialRef: string; readonly label: string }): Promise<string | null>;
};

export function createColetorProvisioner(): ColetorProvisioner {
  const available = n8nDisponivel();

  return {
    available,

    async provisionar(input) {
      if (!available) return null;

      const template = TEMPLATE_BY_PLATFORM[input.platform];
      if (!template) return null;

      const credentialId = credentialIdOf(input.credentialRef);
      if (!credentialId) return null;

      const corpo = montarWorkflow(template, CREDENTIAL_TYPE[input.platform], credentialId, `Coletor · ORLA · coletor · ${input.label}`);
      if (!corpo) {
        logger.error('coletor.provisionar.template_sem_credencial', { platform: input.platform });
        return null;
      }

      return criarWorkflow(corpo, { tipo: 'coletor', platform: input.platform });
    },
  };
}
