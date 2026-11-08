export type VaultSecret = {
  readonly label: string;
  readonly platform: 'google' | 'meta';
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly clientId: string;
  readonly clientSecret: string;
};

export type CredentialVault = {
  readonly available: boolean;
  store(secret: VaultSecret): Promise<string>;
};
