import type { Platform } from '@/modules/connections/domain/connection';

export type DiscoveredAccount = {
  readonly platform: Platform;
  readonly externalId: string;
  readonly name: string;
  readonly currency: string;
  readonly timezone: string;
  readonly managerExternalId: string | null;
  readonly spendingLast30Days: number | null;
  readonly inactive: boolean;
};

const GOOGLE_CUSTOMER_PREFIX = 'customers/';

export function parseAccessibleCustomers(payload: unknown): readonly string[] {
  if (payload === null || typeof payload !== 'object') return [];
  const names = (payload as { resourceNames?: unknown }).resourceNames;
  if (!Array.isArray(names)) return [];

  return names
    .filter((name): name is string => typeof name === 'string' && name.startsWith(GOOGLE_CUSTOMER_PREFIX))
    .map((name) => name.slice(GOOGLE_CUSTOMER_PREFIX.length))
    .filter((id) => /^\d{8,12}$/.test(id));
}

export function formatGoogleCustomerId(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}

type GoogleRow = {
  customerClient?: {
    id?: string;
    descriptiveName?: string;
    currencyCode?: string;
    timeZone?: string;
    manager?: boolean;
    status?: string;
    level?: string;
  };
};

export type TriagemGoogle = {
  readonly contas: readonly DiscoveredAccount[];
  readonly administradoras: number;
  readonly linhas: number;
};

export function triarClientesGoogle(payload: unknown, managerId: string | null): TriagemGoogle {
  if (payload === null || typeof payload !== 'object') return { contas: [], administradoras: 0, linhas: 0 };

  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return { contas: [], administradoras: 0, linhas: 0 };

  const clientes = results
    .map((row) => (row as GoogleRow).customerClient)
    .filter((client): client is NonNullable<GoogleRow['customerClient']> => Boolean(client?.id));

  return {
    linhas: clientes.length,
    administradoras: clientes.filter((client) => client.manager === true).length,
    contas: parseGoogleCustomerClients(payload, managerId),
  };
}

export function parseGoogleCustomerClients(payload: unknown, managerId: string | null): readonly DiscoveredAccount[] {
  if (payload === null || typeof payload !== 'object') return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  return results
    .map((row) => (row as GoogleRow).customerClient)
    .filter((client): client is NonNullable<GoogleRow['customerClient']> => Boolean(client?.id))
    .filter((client) => client.manager !== true)
    .map((client) => ({
      platform: 'google' as const,
      externalId: formatGoogleCustomerId(client.id!),
      name: client.descriptiveName?.trim() || formatGoogleCustomerId(client.id!),
      currency: client.currencyCode ?? 'BRL',
      timezone: client.timeZone ?? 'America/Sao_Paulo',
      managerExternalId: managerId ? formatGoogleCustomerId(managerId) : null,
      spendingLast30Days: null,
      inactive: client.status !== undefined && client.status !== 'ENABLED',
    }));
}

type MetaAccount = {
  id?: string;
  account_id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
  amount_spent?: string;
  business?: { id?: string };
};

export function parseMetaAdAccounts(payload: unknown): readonly DiscoveredAccount[] {
  if (payload === null || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => item as MetaAccount)
    .filter((account) => typeof account.id === 'string' || typeof account.account_id === 'string')
    .map((account) => {
      const externalId = account.id?.startsWith('act_')
        ? account.id
        : `act_${account.account_id ?? account.id}`;

      return {
        platform: 'meta' as const,
        externalId,
        name: account.name?.trim() || externalId,
        currency: account.currency ?? 'BRL',
        timezone: account.timezone_name ?? 'America/Sao_Paulo',
        managerExternalId: account.business?.id ?? null,
        spendingLast30Days: account.amount_spent ? Number(account.amount_spent) / 100 : null,
        inactive: account.account_status !== undefined && account.account_status !== 1,
      };
    });
}

function acessadaPorAdministradora(account: DiscoveredAccount): boolean {
  return account.managerExternalId !== null && account.managerExternalId !== account.externalId;
}

export function dedupe(accounts: readonly DiscoveredAccount[]): readonly DiscoveredAccount[] {
  const melhor = new Map<string, DiscoveredAccount>();

  for (const account of accounts) {
    const chave = `${account.platform}:${account.externalId}`;
    const atual = melhor.get(chave);

    if (!atual || (!acessadaPorAdministradora(atual) && acessadaPorAdministradora(account))) {
      melhor.set(chave, account);
    }
  }

  return [...melhor.values()];
}

function recurso(
  platform: Platform,
  externalId: string,
  name: string,
  inactive = false,
): DiscoveredAccount {
  return {
    platform,
    externalId,
    name: name.trim() || externalId,
    currency: '',
    timezone: '',
    managerExternalId: null,
    spendingLast30Days: null,
    inactive,
  };
}

export function parseGa4Properties(payload: unknown): readonly DiscoveredAccount[] {
  if (payload === null || typeof payload !== 'object') return [];
  const resumos = (payload as { accountSummaries?: unknown }).accountSummaries;
  if (!Array.isArray(resumos)) return [];

  const propriedades: DiscoveredAccount[] = [];
  for (const resumo of resumos) {
    const propriedadesDaConta = (resumo as { propertySummaries?: unknown }).propertySummaries;
    if (!Array.isArray(propriedadesDaConta)) continue;

    for (const propriedade of propriedadesDaConta) {
      const path = (propriedade as { property?: unknown }).property;
      if (typeof path !== 'string' || !path.startsWith('properties/')) continue;
      const externalId = path.slice('properties/'.length);
      const nome = (propriedade as { displayName?: unknown }).displayName;
      propriedades.push(recurso('ga4', externalId, typeof nome === 'string' ? nome : externalId));
    }
  }

  return propriedades;
}

export function parseGtmContainers(payload: unknown): readonly DiscoveredAccount[] {
  if (payload === null || typeof payload !== 'object') return [];
  const containers = (payload as { container?: unknown }).container;
  if (!Array.isArray(containers)) return [];

  return containers
    .map((item) => item as { containerId?: unknown; publicId?: unknown; name?: unknown })
    .filter((item) => typeof item.containerId === 'string' || typeof item.publicId === 'string')
    .map((item) => {
      const externalId =
        typeof item.publicId === 'string' ? item.publicId : String(item.containerId);
      return recurso('gtm', externalId, typeof item.name === 'string' ? item.name : externalId);
    });
}

export function parseSearchConsoleSites(payload: unknown): readonly DiscoveredAccount[] {
  if (payload === null || typeof payload !== 'object') return [];
  const entradas = (payload as { siteEntry?: unknown }).siteEntry;
  if (!Array.isArray(entradas)) return [];

  return entradas
    .map((item) => item as { siteUrl?: unknown; permissionLevel?: unknown })
    .filter((item) => typeof item.siteUrl === 'string')
    .map((item) =>
      recurso(
        'searchconsole',
        item.siteUrl as string,
        item.siteUrl as string,
        item.permissionLevel === 'siteUnverifiedUser',
      ),
    );
}

export function parseYoutubeChannels(payload: unknown): readonly DiscoveredAccount[] {
  if (payload === null || typeof payload !== 'object') return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => item as { id?: unknown; snippet?: { title?: unknown } })
    .filter((item) => typeof item.id === 'string')
    .map((item) =>
      recurso(
        'youtube',
        item.id as string,
        typeof item.snippet?.title === 'string' ? item.snippet.title : (item.id as string),
      ),
    );
}

export function parseGbpLocations(payload: unknown): readonly DiscoveredAccount[] {
  if (payload === null || typeof payload !== 'object') return [];
  const locations = (payload as { locations?: unknown }).locations;
  if (!Array.isArray(locations)) return [];

  return locations
    .map((item) => item as { name?: unknown; title?: unknown })
    .filter((item) => typeof item.name === 'string' && item.name.startsWith('locations/'))
    .map((item) => {
      const externalId = (item.name as string).slice('locations/'.length);
      return recurso('gbp', externalId, typeof item.title === 'string' ? item.title : externalId);
    });
}

export function parseGbpAccounts(payload: unknown): readonly string[] {
  if (payload === null || typeof payload !== 'object') return [];
  const accounts = (payload as { accounts?: unknown }).accounts;
  if (!Array.isArray(accounts)) return [];

  return accounts
    .map((item) => (item as { name?: unknown }).name)
    .filter((name): name is string => typeof name === 'string' && name.startsWith('accounts/'))
    .map((name) => name.slice('accounts/'.length));
}

export function parseGtmAccountIds(payload: unknown): readonly string[] {
  if (payload === null || typeof payload !== 'object') return [];
  const contas = (payload as { account?: unknown }).account;
  if (!Array.isArray(contas)) return [];

  return contas
    .map((item) => (item as { accountId?: unknown }).accountId)
    .filter((id): id is string => typeof id === 'string');
}

export function sortForSelection(accounts: readonly DiscoveredAccount[]): readonly DiscoveredAccount[] {
  return [...accounts].sort((left, right) => {
    if (left.inactive !== right.inactive) return left.inactive ? 1 : -1;
    return left.name.localeCompare(right.name, 'pt-BR');
  });
}
