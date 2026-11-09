import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import { logger } from '@/shared/logging/logger';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { CredentialVault } from '@/modules/connections/application/credentialVault';
import {
  CREDENCIAL_SEM_COFRE,
  veiculaAnuncio,
  type Connection,
  type GrantType,
} from '@/modules/connections/domain/connection';
import {
  PROVIDERS,
  hasRequiredScopes,
  longLivedExchangeUrl,
  parseTokenResponse,
  tokenExchangeRequest,
  type PlataformaOauth,
} from '@/modules/connections/domain/oauth';
import type { ConnectionRepository } from '@/modules/connections/infrastructure/connectionRepository';
import type { DiscoveredAccount } from '@/modules/connections/domain/discovery';
import type { DiscoveredAccountRepository } from '@/modules/connections/infrastructure/discoveredAccountRepository';
import type { PlatformDiscovery } from '@/modules/connections/application/platformDiscoveryPort';
import type { OrganizationService } from '@/modules/organizations/application/organizationService';

export type AuthorizationInput = {
  readonly organizationId: string | null;
  readonly actorId: string;
  readonly platform: PlataformaOauth;
  readonly code: string;
  readonly codeVerifier: string | null;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly requestId: string;
  readonly sourceIp: string | null;
};

export type AuthorizationOutcome = {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly discovered: number;
  readonly organizationCreated: boolean;
};

function administradoraDe(accounts: readonly DiscoveredAccount[]): string | null {
  const gerenciada = accounts.find(
    (account) => account.managerExternalId !== null && account.managerExternalId !== account.externalId,
  );

  return gerenciada?.managerExternalId ?? null;
}

export type AuthorizationService = {
  complete(input: AuthorizationInput): Promise<Result<AuthorizationOutcome, Failure>>;
};

const GRANT_BY_PLATFORM: Record<PlataformaOauth, GrantType> = {
  google: 'oauth_user',
  meta: 'oauth_user',
  rdstation: 'oauth_user',
};

export function createAuthorizationService(
  organizations: OrganizationService,
  connections: ConnectionRepository,
  discovered: DiscoveredAccountRepository,
  discovery: PlatformDiscovery,
  vault: CredentialVault,
  audit: AuditRecorder,
): AuthorizationService {
  return {
    async complete(input) {
      const provider = PROVIDERS[input.platform];

      const exchange = tokenExchangeRequest(provider, {
        code: input.code,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        redirectUri: input.redirectUri,
        codeVerifier: input.codeVerifier ?? undefined,
      });

      const response = await fetch(exchange.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: exchange.body,
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        logger.warn('oauth.exchange.failed', { platform: input.platform, status: response.status });
        return err(failure('unavailable', 'A plataforma recusou a troca do código de autorização.'));
      }

      let granted = parseTokenResponse(input.platform, await response.json());
      if (!granted) return err(failure('unavailable', 'A plataforma devolveu uma resposta inesperada.'));

      if (!hasRequiredScopes(input.platform, granted.grantedScopes)) {
        return err(
          failure('forbidden', 'A autorização não concedeu as permissões mínimas de leitura das campanhas.'),
        );
      }

      if (input.platform === 'meta') {
        const longLived = await fetch(
          longLivedExchangeUrl({
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            shortLivedToken: granted.accessToken,
          }),
          { signal: AbortSignal.timeout(15_000) },
        );

        if (longLived.ok) {
          const upgraded = parseTokenResponse('meta', await longLived.json());
          if (upgraded) granted = { ...upgraded, grantedScopes: granted.grantedScopes };
        }
      }

      const accounts = veiculaAnuncio(input.platform)
        ? input.platform === 'google'
          ? await discovery.google(granted.accessToken)
          : await discovery.meta(granted.accessToken)
        : [];

      const existing = await organizations.exists();
      const organizationCreated = input.organizationId === null;

      if (input.organizationId === null && existing) {
        logger.warn('oauth.authorize.ambiguous_tenant', { platform: input.platform });
        return err(
          failure(
            'forbidden',
            'A autorização não indicou a qual organização pertence. Recomece o fluxo a partir da plataforma.',
          ),
        );
      }

      const organization = organizationCreated
        ? await organizations.create(
            {
              name: accounts[0]?.name ?? provider.label,
              type: accounts.length > 1 ? 'agency' : 'advertiser',
              managerAccountId: administradoraDe(accounts),
              businessManagerId: input.platform === 'meta' ? administradoraDe(accounts) : null,
              developerTokenRef: null,
            },
            { userId: input.actorId, requestId: input.requestId, sourceIp: input.sourceIp },
          )
        : await organizations.byId(input.organizationId!);

      if (!organization.ok) return err(organization.error);
      const organizationId = organization.value.id;

      let credentialRef: string = CREDENCIAL_SEM_COFRE;
      if (vault.available) {
        credentialRef = await vault.store({
          label: `tria · ${provider.label} · ${organization.value.slug}`,
          platform: input.platform,
          accessToken: granted.accessToken,
          refreshToken: granted.refreshToken,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
        });
      }

      const identidade = await discovery.identify(input.platform, granted.accessToken);
      if (!identidade) {
        logger.warn('oauth.authorize.sem_identidade', { platform: input.platform });
        return err(
          failure('unavailable', 'A plataforma não informou qual conta concedeu o acesso.'),
        );
      }

      const externalId = identidade.id;
      const already = await connections.findByExternalId(organizationId, input.platform, externalId);

      const proposta = {
        organizationId,
        platform: input.platform,
        grantType: GRANT_BY_PLATFORM[input.platform],
        label: `${provider.label} · ${organization.value.name}`,
        externalId,
        accountEmail: identidade.email,
        scopes: granted.grantedScopes,
        credentialRef,
        status: (vault.available ? 'active' : 'degraded') as Connection['status'],
        expiresAt: granted.expiresInSeconds
          ? new Date(Date.now() + granted.expiresInSeconds * 1000)
          : null,
      };

      const connection = already
        ? await connections.renew({ ...proposta, id: already.id })
        : await connections.insert(proposta);

      const credencialTrocada =
        already && already.credentialRef !== credentialRef ? already.credentialRef : null;
      const descarte = credencialTrocada ? await vault.discard(credencialTrocada) : null;

      const stored = await discovered.replace(organizationId, connection.id, accounts);

      await audit.record({
        organizationId,
        actorType: 'user',
        actorId: input.actorId,
        action: 'connection.authorize',
        targetType: 'connection',
        targetId: connection.id,
        requestId: input.requestId,
        sourceIp: input.sourceIp,
        metadata: {
          platform: input.platform,
          tenantBinding: organizationCreated ? 'criada-no-fluxo' : 'vinda-do-inicio',
          grantedScopes: granted.grantedScopes,
          discoveredAccounts: stored,
          discoveryFailure: discovery.lastFailure(),
          varredura: discovery.lastSweep(),
          credencialAnterior: descarte,
          vaultAvailable: vault.available,
          organizationCreated,
          refreshTokenReceived: granted.refreshToken !== null,
        },
      });

      return ok({ organizationId, connectionId: connection.id, discovered: stored, organizationCreated });
    },
  };
}
