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
  type Platform,
} from '@/modules/connections/domain/connection';
import {
  PROVIDERS,
  escopoExcedente,
  hasRequiredScopes,
  longLivedExchangeRequest,
  parseTokenResponse,
  tokenExchangeRequest,
  usaOauthDaMeta,
  type PlataformaOauth,
} from '@/modules/connections/domain/oauth';
import type { ConnectionRepository } from '@/modules/connections/infrastructure/connectionRepository';
import type { DiscoveredAccount } from '@/modules/connections/domain/discovery';
import type { DiscoveredAccountRepository } from '@/modules/connections/infrastructure/discoveredAccountRepository';
import type { PlatformDiscovery } from '@/modules/connections/application/platformDiscoveryPort';
import type { OrganizationService } from '@/modules/organizations/application/organizationService';
import { canAdminister, type MemberRole } from '@/modules/identity/domain/user';

export type AutorizadoPor =
  | { readonly via: 'staff'; readonly papel: MemberRole | null }
  | { readonly via: 'invite'; readonly inviteItemId: string };

export type AuthorizationInput = {
  readonly organizationId: string | null;
  readonly autorizadoPor: AutorizadoPor;
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

async function atualizarAdministradoraDescoberta(
  organizations: OrganizationService,
  organization: { readonly id: string; readonly managerAccountId: string | null; readonly businessManagerId: string | null },
  platform: Platform,
  accounts: readonly DiscoveredAccount[],
  ator: { readonly userId: string; readonly requestId: string; readonly sourceIp: string | null },
  papel: MemberRole | null,
): Promise<void> {
  if (!veiculaAnuncio(platform) || !papel) return;

  const administradora = administradoraDe(accounts);
  if (!administradora) return;

  if (platform === 'google' && !organization.managerAccountId) {
    await organizations.setManagerAccountId(
      { id: organization.id, papelDeQuemAge: papel, managerAccountId: administradora },
      ator,
    );
  }

  if (platform === 'meta' && !organization.businessManagerId) {
    await organizations.setBusinessManagerId(
      { id: organization.id, papelDeQuemAge: papel, businessManagerId: administradora },
      ator,
    );
  }
}

export type AuthorizationService = {
  complete(input: AuthorizationInput): Promise<Result<AuthorizationOutcome, Failure>>;
};

function descobrirRecursos(
  discovery: PlatformDiscovery,
  platform: Platform,
  accessToken: string,
): Promise<readonly DiscoveredAccount[]> {
  if (veiculaAnuncio(platform)) {
    return platform === 'google' ? discovery.google(accessToken) : discovery.meta(accessToken);
  }

  switch (platform) {
    case 'ga4':
      return discovery.ga4(accessToken);
    case 'gtm':
      return discovery.gtm(accessToken);
    case 'searchconsole':
      return discovery.searchconsole(accessToken);
    case 'youtube':
      return discovery.youtube(accessToken);
    case 'gbp':
      return discovery.gbp(accessToken);
    default:
      return Promise.resolve([]);
  }
}

const GRANT_BY_PLATFORM: Record<PlataformaOauth, GrantType> = {
  google: 'oauth_user',
  meta: 'oauth_user',
  rdstation: 'oauth_user',
  ga4: 'oauth_user',
  gtm: 'oauth_user',
  pixel: 'oauth_user',
  searchconsole: 'oauth_user',
  youtube: 'oauth_user',
  gbp: 'oauth_user',
  whatsapp: 'oauth_user',
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
      if (input.organizationId !== null && input.autorizadoPor.via === 'staff') {
        if (!input.autorizadoPor.papel || !canAdminister(input.autorizadoPor.papel)) {
          logger.warn('oauth.authorize.papel_insuficiente', {
            platform: input.platform,
            role: input.autorizadoPor.papel,
          });
          return err(
            failure('forbidden', 'Só quem administra a organização pode autorizar plataformas.'),
          );
        }
      }

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
        headers: { 'Content-Type': exchange.contentType, Accept: 'application/json' },
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

      const excedente = escopoExcedente(input.platform, granted.grantedScopes);
      if (excedente.length > 0) {
        logger.warn('oauth.authorize.escopo_excedente', {
          platform: input.platform,
          excedente,
        });
        return err(
          failure(
            'forbidden',
            'A autorização voltou com permissão além do que esta conexão precisa. ' +
              'Revogue o acesso da Orla na sua Conta Google e autorize de novo.',
          ),
        );
      }

      if (usaOauthDaMeta(input.platform)) {
        const troca = longLivedExchangeRequest({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          shortLivedToken: granted.accessToken,
        });

        const longLived = await fetch(troca.url, {
          method: 'POST',
          headers: { 'Content-Type': troca.contentType, Accept: 'application/json' },
          body: troca.body,
          signal: AbortSignal.timeout(15_000),
        });

        if (longLived.ok) {
          const upgraded = parseTokenResponse('meta', await longLived.json());
          if (upgraded) granted = { ...upgraded, grantedScopes: granted.grantedScopes };
        }
      }

      const accounts = await descobrirRecursos(discovery, input.platform, granted.accessToken);

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

      if (!organizationCreated && input.autorizadoPor.via === 'staff') {
        await atualizarAdministradoraDescoberta(organizations, organization.value, input.platform, accounts, {
          userId: input.actorId,
          requestId: input.requestId,
          sourceIp: input.sourceIp,
        }, input.autorizadoPor.papel);
      }

      const identidade = await discovery.identify(input.platform, granted.accessToken);
      if (!identidade) {
        logger.warn('oauth.authorize.sem_identidade', { platform: input.platform });
        return err(
          failure('unavailable', 'A plataforma não informou qual conta concedeu o acesso.'),
        );
      }

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
        authorizedVia: input.autorizadoPor.via === 'invite' ? ('invite' as const) : ('staff' as const),
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
        actorType: input.autorizadoPor.via === 'invite' ? 'invite' : 'user',
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
          ...(input.autorizadoPor.via === 'invite'
            ? { inviteItemId: input.autorizadoPor.inviteItemId }
            : {}),
        },
      });

      return ok({ organizationId, connectionId: connection.id, discovered: stored, organizationCreated });
    },
  };
}
