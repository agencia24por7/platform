import { logger } from '@/shared/logging/logger';
import { redactText } from '@/shared/logging/redact';
import {
  dedupe,
  parseAccessibleCustomers,
  parseGoogleCustomerClients,
  parseMetaAdAccounts,
  sortForSelection,
  type DiscoveredAccount,
} from '@/modules/connections/domain/discovery';
import type { Platform } from '@/modules/connections/domain/connection';

const GOOGLE_API = 'https://googleads.googleapis.com/v22';
const GRAPH_API = 'https://graph.facebook.com/v21.0';
const TIMEOUT_MS = 15_000;

const CLIENT_QUERY = [
  'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,',
  'customer_client.time_zone, customer_client.manager, customer_client.status',
  'FROM customer_client WHERE customer_client.level <= 2',
].join(' ');

export type PlatformDiscovery = {
  google(accessToken: string): Promise<readonly DiscoveredAccount[]>;
  meta(accessToken: string): Promise<readonly DiscoveredAccount[]>;
  identify(platform: Platform, accessToken: string): Promise<string | null>;
};

const MOTIVO_MAX = 400;

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

  if (!response.ok) {
    logger.warn('discovery.request.failed', {
      url: new URL(url).pathname,
      status: response.status,
      motivo: await reasonOf(response),
    });
    return null;
  }

  return response.json();
}

async function reasonOf(response: Response): Promise<string> {
  try {
    return redactText((await response.text()).slice(0, MOTIVO_MAX));
  } catch {
    return 'corpo ilegível';
  }
}

export function createPlatformDiscovery(): PlatformDiscovery {
  return {
    async google(accessToken) {
      const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

      const accessible = parseAccessibleCustomers(
        await fetchJson(`${GOOGLE_API}/customers:listAccessibleCustomers`, { headers }),
      );

      const discovered: DiscoveredAccount[] = [];

      for (const customerId of accessible) {
        const payload = await fetchJson(`${GOOGLE_API}/customers/${customerId}/googleAds:search`, {
          method: 'POST',
          headers: { ...headers, 'login-customer-id': customerId },
          body: JSON.stringify({ query: CLIENT_QUERY }),
        });

        discovered.push(...parseGoogleCustomerClients(payload, customerId));
      }

      logger.info('discovery.google.done', { roots: accessible.length, accounts: discovered.length });
      return sortForSelection(dedupe(discovered));
    },

    async identify(platform, accessToken) {
      const url =
        platform === 'google'
          ? 'https://www.googleapis.com/oauth2/v3/userinfo'
          : `${GRAPH_API}/me?fields=id`;

      const payload = await fetchJson(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (typeof payload !== 'object' || payload === null) return null;

      const identificador = (payload as Record<string, unknown>)[platform === 'google' ? 'sub' : 'id'];
      return typeof identificador === 'string' && identificador.length > 0 ? identificador : null;
    },

    async meta(accessToken) {
      const fields = 'id,name,currency,timezone_name,account_status,amount_spent,business';
      const owned = await fetchJson(
        `${GRAPH_API}/me/adaccounts?fields=${fields}&limit=200`,
        { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const accounts = parseMetaAdAccounts(owned);
      logger.info('discovery.meta.done', { accounts: accounts.length });
      return sortForSelection(dedupe(accounts));
    },
  };
}
