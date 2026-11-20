import { logger } from '@/shared/logging/logger';
import { redactText } from '@/shared/logging/redact';
import {
  dedupe,
  parseAccessibleCustomers,
  triarClientesGoogle,
  parseMetaAdAccounts,
  parseGa4Properties,
  parseGtmAccountIds,
  parseGtmContainers,
  parseSearchConsoleSites,
  parseYoutubeChannels,
  parseGbpAccounts,
  urlDosLocaisDoGbp,
  parseGbpLocations,
  parseMetaPixels,
  parseMetaPages,
  proximaPaginaDoGraph,
  urlDasPaginasDaMeta,
  urlsDosConjuntosDeDadosDaMeta,
  sortForSelection,
  type DiscoveredAccount,
} from '@/modules/connections/domain/discovery';
import type { Platform } from '@/modules/connections/domain/connection';
import type { PlatformDiscovery, Varredura } from '@/modules/connections/application/platformDiscoveryPort';
import { GOOGLE_ADS_VERSION } from '@/modules/connections/domain/googleAdsVersion';
import { resumirFalha } from '@/modules/connections/domain/falhaDescoberta';

const GOOGLE_API = `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}`;
const GRAPH_API = 'https://graph.facebook.com/v23.0';
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

const MAX_PAGINAS = 20;

async function fetchTodasAsPaginas(
  baseUrl: string,
  headers: Record<string, string>,
  parametroDaPagina: string,
): Promise<readonly unknown[]> {
  const paginas: unknown[] = [];
  let pageToken: string | undefined;

  for (let i = 0; i < MAX_PAGINAS; i++) {
    const url = new URL(baseUrl);
    if (pageToken) url.searchParams.set(parametroDaPagina, pageToken);

    const payload = await fetchJson(url.toString(), { headers });
    if (payload === null || typeof payload !== 'object') break;
    paginas.push(payload);

    const proximo = (payload as { nextPageToken?: unknown }).nextPageToken;
    if (typeof proximo !== 'string' || proximo.length === 0) break;
    pageToken = proximo;
  }

  return paginas;
}

async function fetchPaginasDoGraph(url: string, accessToken: string): Promise<readonly unknown[]> {
  const paginas: unknown[] = [];
  let proxima: string | null = url;

  for (let i = 0; i < MAX_PAGINAS && proxima; i++) {
    const payload = await fetchJson(proxima, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } });
    if (payload === null || typeof payload !== 'object') break;
    paginas.push(payload);
    proxima = proximaPaginaDoGraph(payload);
  }

  return paginas;
}

async function reasonOf(response: Response): Promise<string> {
  try {
    return redactText((await response.text()).slice(0, MOTIVO_MAX));
  } catch {
    return 'corpo ilegível';
  }
}

type OndeSeIdentifica = { readonly url: string; readonly camposDoId: readonly string[] };

const ONDE_SE_IDENTIFICA: Partial<Record<Platform, OndeSeIdentifica>> = {
  google: { url: 'https://www.googleapis.com/oauth2/v3/userinfo', camposDoId: ['sub'] },
  meta: { url: `${GRAPH_API}/me?fields=id,email`, camposDoId: ['id'] },
  rdstation: {
    url: 'https://crm.rdstation.com/api/v1/users/me',
    camposDoId: ['id', '_id'],
  },
  ga4: { url: 'https://www.googleapis.com/oauth2/v3/userinfo', camposDoId: ['sub'] },
  gtm: { url: 'https://www.googleapis.com/oauth2/v3/userinfo', camposDoId: ['sub'] },
  pixel: { url: `${GRAPH_API}/me?fields=id,email`, camposDoId: ['id'] },
  leadads: { url: `${GRAPH_API}/me?fields=id,email`, camposDoId: ['id'] },
  searchconsole: { url: 'https://www.googleapis.com/oauth2/v3/userinfo', camposDoId: ['sub'] },
  youtube: { url: 'https://www.googleapis.com/oauth2/v3/userinfo', camposDoId: ['sub'] },
  gbp: { url: 'https://www.googleapis.com/oauth2/v3/userinfo', camposDoId: ['sub'] },
  whatsapp: { url: `${GRAPH_API}/me?fields=id,email`, camposDoId: ['id'] },
};

function primeiroIdentificador(
  dados: Record<string, unknown>,
  campos: readonly string[],
): string | null {
  for (const campo of campos) {
    const valor = dados[campo];
    if (typeof valor === 'string' && valor.length > 0) return valor;
    if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  }
  return null;
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
      const onde = ONDE_SE_IDENTIFICA[platform];
      if (!onde) {
        logger.warn('discovery.identify.plataforma_sem_identidade', { platform });
        return null;
      }

      const payload = await fetchJson(onde.url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (typeof payload !== 'object' || payload === null) return null;

      const dados = payload as Record<string, unknown>;
      const identificador = primeiroIdentificador(dados, onde.camposDoId);
      if (!identificador) {
        logger.warn('discovery.identify.sem_identificador_estavel', {
          platform,
          procurados: onde.camposDoId,
          devolvidos: Object.keys(dados),
        });
        return null;
      }

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

    async pixel(accessToken) {
      esquecerFalhas();
      const conjuntos: DiscoveredAccount[] = [];
      for (const url of urlsDosConjuntosDeDadosDaMeta()) {
        const paginas = await fetchPaginasDoGraph(url, accessToken);
        conjuntos.push(...paginas.flatMap((pagina) => parseMetaPixels(pagina)));
      }
      const unicos = sortForSelection(dedupe(conjuntos));
      logger.info('discovery.pixel.done', { brutos: conjuntos.length, conjuntos: unicos.length });
      return unicos;
    },

    async leadads(accessToken) {
      esquecerFalhas();
      const paginas = await fetchPaginasDoGraph(urlDasPaginasDaMeta(), accessToken);
      const paginasDoFacebook = sortForSelection(dedupe(paginas.flatMap((pagina) => parseMetaPages(pagina))));
      logger.info('discovery.leadads.done', { paginas: paginasDoFacebook.length });
      return paginasDoFacebook;
    },

    async ga4(accessToken) {
      esquecerFalhas();
      const headers = { Authorization: `Bearer ${accessToken}` };
      const paginas = await fetchTodasAsPaginas(
        'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200',
        headers,
        'pageToken',
      );
      const propriedades = paginas.flatMap((pagina) => parseGa4Properties(pagina));
      logger.info('discovery.ga4.done', { paginas: paginas.length, propriedades: propriedades.length });
      return sortForSelection(propriedades);
    },

    async gtm(accessToken) {
      esquecerFalhas();
      const headers = { Authorization: `Bearer ${accessToken}` };
      const contas = parseGtmAccountIds(
        await fetchJson('https://www.googleapis.com/tagmanager/v2/accounts', { headers }),
      );

      const containers: DiscoveredAccount[] = [];
      for (const contaId of contas) {
        const payload = await fetchJson(
          `https://www.googleapis.com/tagmanager/v2/accounts/${contaId}/containers`,
          { headers },
        );
        containers.push(...parseGtmContainers(payload));
      }

      logger.info('discovery.gtm.done', { contas: contas.length, containers: containers.length });
      return sortForSelection(containers);
    },

    async searchconsole(accessToken) {
      esquecerFalhas();
      const payload = await fetchJson('https://www.googleapis.com/webmasters/v3/sites', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const sites = parseSearchConsoleSites(payload);
      logger.info('discovery.searchconsole.done', { sites: sites.length });
      return sortForSelection(sites);
    },

    async youtube(accessToken) {
      esquecerFalhas();
      const headers = { Authorization: `Bearer ${accessToken}` };
      const paginas = await fetchTodasAsPaginas(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50',
        headers,
        'pageToken',
      );
      const canais = paginas.flatMap((pagina) => parseYoutubeChannels(pagina));
      logger.info('discovery.youtube.done', { paginas: paginas.length, canais: canais.length });
      return sortForSelection(canais);
    },

    async gbp(accessToken) {
      esquecerFalhas();
      const headers = { Authorization: `Bearer ${accessToken}` };
      const paginasDeContas = await fetchTodasAsPaginas(
        'https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20',
        headers,
        'pageToken',
      );
      const contas = paginasDeContas.flatMap((pagina) => parseGbpAccounts(pagina));

      const locais: DiscoveredAccount[] = [];
      for (const contaId of contas) {
        const paginasDeLocais = await fetchTodasAsPaginas(
          urlDosLocaisDoGbp(contaId),
          headers,
          'pageToken',
        );
        locais.push(...paginasDeLocais.flatMap((pagina) => parseGbpLocations(pagina)));
      }

      logger.info('discovery.gbp.done', { contas: contas.length, locais: locais.length });
      return sortForSelection(locais);
    },
  };
}
