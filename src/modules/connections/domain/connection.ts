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
  readonly accountEmail: string | null;
  readonly scopes: readonly string[];
  readonly credentialRef: string;
  readonly status: ConnectionStatus;
  readonly expiresAt: Date | null;
  readonly authorizedAt: Date;
};

export type NewConnection = Omit<Connection, 'id' | 'status' | 'authorizedAt'> & {
  readonly expiresAt: Date | null;
  readonly status?: Connection['status'];
};

export const CREDENCIAL_SEM_COFRE = 'pendente:cofre-indisponivel';

export function readinessOf(connection: Pick<Connection, 'status' | 'credentialRef'>): {
  readonly collectable: boolean;
  readonly reason: string | null;
} {
  if (connection.credentialRef.startsWith('pendente:')) {
    return { collectable: false, reason: 'A credencial não foi guardada: o cofre do n8n não respondeu.' };
  }
  if (connection.status === 'revoked') {
    return { collectable: false, reason: 'Autorização revogada na plataforma.' };
  }
  if (connection.status === 'reauth_pending') {
    return { collectable: false, reason: 'A plataforma pediu nova autorização.' };
  }
  if (connection.status === 'degraded') {
    return { collectable: false, reason: 'Autorização incompleta. Reconecte para coletar.' };
  }
  return { collectable: true, reason: null };
}

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
