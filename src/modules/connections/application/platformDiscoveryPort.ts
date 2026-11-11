import type { Platform } from '@/modules/connections/domain/connection';
import type { DiscoveredAccount } from '@/modules/connections/domain/discovery';

export type GrantingAccount = { readonly id: string; readonly email: string | null };

export type Varredura = {
  readonly raizes: number;
  readonly brutas: number;
  readonly administradoras: number;
  readonly recusadas: number;
};

export type PlatformDiscovery = {
  google(accessToken: string): Promise<readonly DiscoveredAccount[]>;
  meta(accessToken: string): Promise<readonly DiscoveredAccount[]>;
  ga4(accessToken: string): Promise<readonly DiscoveredAccount[]>;
  gtm(accessToken: string): Promise<readonly DiscoveredAccount[]>;
  searchconsole(accessToken: string): Promise<readonly DiscoveredAccount[]>;
  youtube(accessToken: string): Promise<readonly DiscoveredAccount[]>;
  gbp(accessToken: string): Promise<readonly DiscoveredAccount[]>;
  identify(platform: Platform, accessToken: string): Promise<GrantingAccount | null>;
  lastFailure(): string | null;
  lastSweep(): Varredura;
};
