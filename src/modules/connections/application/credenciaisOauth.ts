import { env } from '@/shared/config/env';
import {
  usaOauthDaMeta,
  usaOauthDoGoogle,
  type PlataformaOauth,
  type ProviderCredentials,
} from '@/modules/connections/domain/oauth';

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
      configId: config.META_LOGIN_CONFIG_ID,
    };
  }

  return {
    clientId: config.RDSTATION_CLIENT_ID,
    clientSecret: config.RDSTATION_CLIENT_SECRET,
  };
}
