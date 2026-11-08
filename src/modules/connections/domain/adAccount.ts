import type { Platform } from '@/modules/connections/domain/connection';

export type AdAccountStatus = 'linked' | 'pending' | 'error' | 'unlinked';

export type AdAccount = {
  readonly id: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly connectionId: string;
  readonly platform: Platform;
  readonly externalId: string;
  readonly name: string;
  readonly accountGroup: string;
  readonly currency: string;
  readonly timezone: string;
  readonly status: AdAccountStatus;
  readonly syncEnabled: boolean;
  readonly lastSyncAt: Date | null;
};

export type NewAdAccount = Omit<AdAccount, 'id' | 'status' | 'lastSyncAt' | 'platform'>;

const GOOGLE_ID = /^\d{3}-\d{3}-\d{4}$/;
const META_ID = /^act_\d{6,20}$/;

export function normalizeExternalId(platform: Platform, raw: string): string {
  const trimmed = raw.trim();
  if (platform === 'meta') return trimmed.startsWith('act_') ? trimmed : `act_${trimmed.replace(/\D/g, '')}`;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : trimmed;
}

export function isValidExternalId(platform: Platform, value: string): boolean {
  return platform === 'google' ? GOOGLE_ID.test(value) : META_ID.test(value);
}
