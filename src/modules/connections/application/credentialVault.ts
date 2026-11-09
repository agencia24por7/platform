import type { Platform } from '@/modules/connections/domain/connection';

export type VaultSecret = {
  readonly label: string;
  readonly platform: Platform;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly clientId: string;
  readonly clientSecret: string;
};

export type DiscardOutcome = 'descartada' | 'sem_permissao' | 'indisponivel' | 'falhou';

export type CredentialVault = {
  readonly available: boolean;
  store(secret: VaultSecret): Promise<string>;
  discard(credentialRef: string): Promise<DiscardOutcome>;
};

export const VAULT_PREFIX = 'n8n:credential:';

export function credentialIdOf(credentialRef: string): string | null {
  if (!credentialRef.startsWith(VAULT_PREFIX)) return null;

  const id = credentialRef.slice(VAULT_PREFIX.length);
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : null;
}
