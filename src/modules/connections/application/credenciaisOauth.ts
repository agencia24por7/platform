import { env } from '@/shared/config/env';
import {
  usaOauthDaMeta,
  usaOauthDoGoogle,
  type PlataformaOauth,
  type ProviderCredentials,
} from '@/modules/connections/domain/oauth';

function configuracaoDeLoginDaMeta(platform: PlataformaOauth, config: ReturnType<typeof env>): string | undefined {
  if (platform === 'whatsapp') return config.WHATSAPP_LOGIN_CONFIG_ID;
  if (platform === 'leadads') return config.LEADADS_LOGIN_CONFIG_ID;
  return config.META_LOGIN_CONFIG_ID;
}

export function credenciaisDaPlataforma(platform: PlataformaOauth): ProviderCredentials {
  const config = env();

  if (usaOauthDoGoogle(platform)) {
    return {
      clientId: config.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
    };
  }

  if (usaOauthDaMeta(platform)) {
    return {
      clientId: config.META_APP_ID,
      clientSecret: config.META_APP_SECRET,
      configId: configuracaoDeLoginDaMeta(platform, config),
    };
  }

  return {
    clientId: config.RDSTATION_CLIENT_ID,
    clientSecret: config.RDSTATION_CLIENT_SECRET,
  };
}
