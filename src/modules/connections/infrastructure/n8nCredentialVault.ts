import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { credentialIdOf } from '@/modules/connections/application/credentialVault';
import type { CredentialVault, VaultSecret } from '@/modules/connections/application/credentialVault';

import type { Platform } from '@/modules/connections/domain/connection';

export const CREDENTIAL_TYPE: Record<Platform, string> = {
  google: 'googleOAuth2Api',
  meta: 'facebookGraphApi',
  rdstation: 'httpHeaderAuth',
  apify: 'httpHeaderAuth',
  ga4: 'googleOAuth2Api',
  zapi: 'httpHeaderAuth',
  gtm: 'googleOAuth2Api',
  pixel: 'facebookGraphApi',
  searchconsole: 'googleOAuth2Api',
  youtube: 'googleOAuth2Api',
  gbp: 'googleOAuth2Api',
  whatsapp: 'facebookGraphApi',
};

function corpoDaCredencial(secret: VaultSecret) {
  if (CREDENTIAL_TYPE[secret.platform] === 'googleOAuth2Api') {
    return {
      clientId: secret.clientId,
      clientSecret: secret.clientSecret,
      oauthTokenData: {
        access_token: secret.accessToken,
        refresh_token: secret.refreshToken,
      },
    };
  }

  if (CREDENTIAL_TYPE[secret.platform] === 'facebookGraphApi') {
    return { accessToken: secret.accessToken };
  }

  return { name: 'Authorization', value: `Bearer ${secret.accessToken}` };
}

export function createN8nCredentialVault(): CredentialVault {
  const config = env();
  const available = Boolean(config.N8N_API_URL && config.N8N_API_KEY);

  return {
    available,

    async discard(credentialRef: string) {
      if (!available) return 'indisponivel' as const;

      const id = credentialIdOf(credentialRef);
      if (!id) return 'falhou' as const;

      try {
        const response = await fetch(
          new URL(`/api/v1/credentials/${id}`, config.N8N_API_URL).toString(),
          { method: 'DELETE', headers: { 'X-N8N-API-KEY': config.N8N_API_KEY! } },
        );

        if (response.ok || response.status === 404) return 'descartada' as const;
        if (response.status === 401 || response.status === 403) return 'sem_permissao' as const;
        return 'falhou' as const;
      } catch {
        return 'falhou' as const;
      }
    },

    async store(secret: VaultSecret): Promise<string> {
      if (!available) throw new Error('Cofre de credenciais não configurado.');

      const body = {
        name: secret.label,
        type: CREDENTIAL_TYPE[secret.platform],
        data: corpoDaCredencial(secret),
      };

      const response = await fetch(new URL('/api/v1/credentials', config.N8N_API_URL).toString(), {
        method: 'POST',
        headers: { 'X-N8N-API-KEY': config.N8N_API_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        logger.error('vault.store.failed', { platform: secret.platform, status: response.status });
        throw new Error('Não foi possível guardar a credencial no cofre.');
      }

      const created = (await response.json()) as { id?: string };
      if (!created.id) throw new Error('Cofre não devolveu identificador da credencial.');

      logger.info('vault.store.ok', { platform: secret.platform, credentialId: created.id });
      return `n8n:credential:${created.id}`;
    },
  };
}
