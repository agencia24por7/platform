import type { Platform } from '@/modules/connections/domain/connection';
import type { DiscoveredAccount } from '@/modules/connections/domain/discovery';

export type GrantingAccount = { readonly id: string; readonly email: string | null };

export type PlatformDiscovery = {
  google(accessToken: string): Promise<readonly DiscoveredAccount[]>;
  meta(accessToken: string): Promise<readonly DiscoveredAccount[]>;
  identify(platform: Platform, accessToken: string): Promise<GrantingAccount | null>;
  lastFailure(): string | null;
};
