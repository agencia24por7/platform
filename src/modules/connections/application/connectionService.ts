import type { Ator } from '@/modules/audit/domain/actor';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { AdAccount, NewAdAccount } from '@/modules/connections/domain/adAccount';
import { isValidExternalId, normalizeExternalId } from '@/modules/connections/domain/adAccount';
import type { Connection, NewConnection, Platform } from '@/modules/connections/domain/connection';
import { grantTypesFor, missingScopes } from '@/modules/connections/domain/connection';
import type { AdAccountRepository } from '@/modules/connections/infrastructure/adAccountRepository';
import type { ConnectionRepository } from '@/modules/connections/infrastructure/connectionRepository';

export type LinkAccountInput = Omit<NewAdAccount, 'organizationId'> & {
  readonly organizationId: string;
  readonly platform: Platform;
};

export type ConnectionService = {
  createConnection(input: NewConnection, ator: Ator): Promise<Result<Connection, Failure>>;
  linkAccount(input: LinkAccountInput, ator: Ator): Promise<Result<AdAccount, Failure>>;
  listConnections(organizationId: string): Promise<readonly Connection[]>;
  listAccountsByClient(organizationId: string, clientId: string): Promise<readonly AdAccount[]>;
  listAccounts(organizationId: string): Promise<readonly (AdAccount & { clientName: string })[]>;
};

export type ClientOwnership = {
  findById(organizationId: string, id: string): Promise<{ readonly id: string } | null>;
};

export function createConnectionService(
  connections: ConnectionRepository,
  accounts: AdAccountRepository,
  audit: AuditRecorder,
  clients: ClientOwnership,
): ConnectionService {
  return {
    async createConnection(input, ator) {
      if (!grantTypesFor(input.platform).includes(input.grantType)) {
        return err(failure('validation', 'Caminho de autorização incompatível com a plataforma.'));
      }

      const absent = missingScopes(input.platform, input.scopes);
      if (absent.length > 0) {
        return err(failure('validation', `Escopo obrigatório ausente: ${absent.join(', ')}.`));
      }

      if (await connections.findByExternalId(input.organizationId, input.platform, input.externalId)) {
        return err(failure('conflict', 'Esta autorização já existe nesta organização.'));
      }

      const connection = await connections.insert(input);

      await audit.record({
        organizationId: connection.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'connection.create',
        targetType: 'connection',
        targetId: connection.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: {
          platform: connection.platform,
          grantType: connection.grantType,
          scopes: connection.scopes,
          credentialRefPresent: connection.credentialRef.length > 0,
        },
      });

      return ok(connection);
    },

    async linkAccount(input, ator) {
      if (!(await clients.findById(input.organizationId, input.clientId))) {
        return err(failure('validation', 'Cliente não encontrado nesta organização.'));
      }

      const connection = await connections.findById(input.organizationId, input.connectionId);
      if (!connection) return err(failure('validation', 'Autorização não encontrada nesta organização.'));
      if (connection.platform !== input.platform) {
        return err(failure('validation', 'A conta não pertence à plataforma desta autorização.'));
      }
      if (connection.status === 'revoked') {
        return err(failure('conflict', 'Autorização revogada. Reautorize antes de vincular contas.'));
      }

      const externalId = normalizeExternalId(input.platform, input.externalId);
      if (!isValidExternalId(input.platform, externalId)) {
        return err(
          failure(
            'validation',
            input.platform === 'google'
              ? 'ID do Google Ads deve ter o formato 123-456-7890.'
              : 'ID do Meta deve ter o formato act_1234567890.',
          ),
        );
      }

      if (await accounts.findByExternalId(input.organizationId, input.platform, externalId)) {
        return err(failure('conflict', 'Esta conta já está vinculada nesta organização.'));
      }

      const account = await accounts.insert({ ...input, externalId });

      await audit.record({
        organizationId: account.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'ad_account.link',
        targetType: 'ad_account',
        targetId: account.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: {
          platform: account.platform,
          externalId: account.externalId,
          clientId: account.clientId,
          connectionId: account.connectionId,
          syncEnabled: account.syncEnabled,
        },
      });

      return ok(account);
    },

    listConnections: (organizationId) => connections.list(organizationId),
    listAccountsByClient: (organizationId, clientId) => accounts.listByClient(organizationId, clientId),
    listAccounts: (organizationId) => accounts.listByOrganization(organizationId),
  };
}
