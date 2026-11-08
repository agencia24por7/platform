export const Platform = { Meta: 'meta', Google: 'google' } as const;
export type Platform = (typeof Platform)[keyof typeof Platform];

export const GrantType = {
  Mcc: 'mcc',
  BmPartner: 'bm_partner',
  SystemUser: 'system_user',
  OauthUser: 'oauth_user',
} as const;
export type GrantType = (typeof GrantType)[keyof typeof GrantType];

export type ConnectionStatus = 'active' | 'expiring' | 'degraded' | 'revoked' | 'reauth_pending';

export type Connection = {
  readonly id: string;
  readonly organizationId: string;
  readonly platform: Platform;
  readonly grantType: GrantType;
  readonly label: string;
  readonly externalId: string;
  readonly scopes: readonly string[];
  readonly credentialRef: string;
  readonly status: ConnectionStatus;
  readonly expiresAt: Date | null;
  readonly authorizedAt: Date;
};

export type NewConnection = Omit<Connection, 'id' | 'status' | 'authorizedAt'> & {
  readonly expiresAt: Date | null;
};

const REQUIRED_SCOPES: Record<Platform, readonly string[]> = {
  google: ['adwords'],
  meta: ['ads_read'],
};

export function missingScopes(platform: Platform, scopes: readonly string[]): readonly string[] {
  return REQUIRED_SCOPES[platform].filter((scope) => !scopes.includes(scope));
}

export function grantTypesFor(platform: Platform): readonly GrantType[] {
  return platform === 'google' ? ['mcc', 'oauth_user'] : ['bm_partner', 'system_user'];
}
