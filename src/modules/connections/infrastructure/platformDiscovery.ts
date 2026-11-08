import { logger } from '@/shared/logging/logger';
import { redactText } from '@/shared/logging/redact';
import {
  dedupe,
  parseAccessibleCustomers,
  triarClientesGoogle,
  parseMetaAdAccounts,
  sortForSelection,
  type DiscoveredAccount,
} from '@/modules/connections/domain/discovery';
import type { Platform } from '@/modules/connections/domain/connection';
import type { PlatformDiscovery, Varredura } from '@/modules/connections/application/platformDiscoveryPort';
import { GOOGLE_ADS_VERSION } from '@/modules/connections/domain/googleAdsVersion';
import { resumirFalha } from '@/modules/connections/domain/falhaDescoberta';

const GOOGLE_API = `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}`;
const GRAPH_API = 'https://graph.facebook.com/v21.0';
const TIMEOUT_MS = 15_000;

const CLIENT_QUERY = [
  'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,',
  'customer_client.time_zone, customer_client.manager, customer_client.status',
  'FROM customer_client WHERE customer_client.level <= 5',
].join(' ');

const MOTIVO_MAX = 1200;

let falhas: string[] = [];
let varredura: Varredura = { raizes: 0, brutas: 0, administradoras: 0, recusadas: 0 };

function esquecerFalhas(): void {
  falhas = [];
  varredura = { raizes: 0, brutas: 0, administradoras: 0, recusadas: 0 };
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

  if (!response.ok) {
    const motivo = await reasonOf(response);
    const resumo = resumirFalha(response.status, motivo);
    if (!falhas.includes(resumo)) falhas.push(resumo);

    logger.warn('discovery.request.failed', {
      url: new URL(url).pathname,
      status: response.status,
      motivo,
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
      esquecerFalhas();
      const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

      const accessible = parseAccessibleCustomers(
        await fetchJson(`${GOOGLE_API}/customers:listAccessibleCustomers`, { headers }),
      );

      const discovered: DiscoveredAccount[] = [];
      let administradoras = 0;
      let recusadas = 0;

      for (const customerId of accessible) {
        const payload = await fetchJson(`${GOOGLE_API}/customers/${customerId}/googleAds:search`, {
          method: 'POST',
          headers: { ...headers, 'login-customer-id': customerId },
          body: JSON.stringify({ query: CLIENT_QUERY }),
        });

        const triagem = triarClientesGoogle(payload, customerId);
        if (payload === null) recusadas += 1;
        administradoras += triagem.administradoras;
        discovered.push(...triagem.contas);

        logger.info('discovery.google.raiz', {
          raiz: customerId,
          linhas: triagem.linhas,
          administradoras: triagem.administradoras,
          contas: triagem.contas.length,
        });
      }

      const unicas = sortForSelection(dedupe(discovered));
      varredura = {
        raizes: accessible.length,
        brutas: discovered.length,
        administradoras,
        recusadas,
      };

      logger.info('discovery.google.done', {
        roots: accessible.length,
        brutas: discovered.length,
        accounts: unicas.length,
        administradoras,
        falhas: falhas.length,
      });

      return unicas;
    },

    lastFailure() {
      return falhas.length === 0 ? null : falhas.join(' · ');
    },

    lastSweep() {
      return varredura;
    },

    async identify(platform, accessToken) {
      const url =
        platform === 'google'
          ? 'https://www.googleapis.com/oauth2/v3/userinfo'
          : `${GRAPH_API}/me?fields=id,email`;

      const payload = await fetchJson(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (typeof payload !== 'object' || payload === null) return null;

      const dados = payload as Record<string, unknown>;
      const identificador = dados[platform === 'google' ? 'sub' : 'id'];
      if (typeof identificador !== 'string' || identificador.length === 0) return null;

      const email = dados['email'];
      return {
        id: identificador,
        email: typeof email === 'string' && email.includes('@') ? email : null,
      };
    },

    async meta(accessToken) {
      esquecerFalhas();
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
