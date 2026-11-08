import type { Ator } from '@/modules/audit/domain/actor';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { Client, ClientWithAccounts, NewClient } from '@/modules/clients/domain/client';
import type { ClientRepository } from '@/modules/clients/infrastructure/clientRepository';

export type ClientService = {
  create(input: NewClient, ator: Ator): Promise<Result<Client, Failure>>;
  byId(organizationId: string, id: string): Promise<Result<Client, Failure>>;
  list(organizationId: string): Promise<readonly ClientWithAccounts[]>;
};

export function createClientService(repository: ClientRepository, audit: AuditRecorder): ClientService {
  return {
    async create(input, ator) {
      if (await repository.findByName(input.organizationId, input.name)) {
        return err(failure('conflict', 'Já existe um cliente com esse nome nesta organização.'));
      }

      if (input.parentClientId) {
        const parent = await repository.findById(input.organizationId, input.parentClientId);
        if (!parent) return err(failure('validation', 'Cliente-pai não pertence a esta organização.'));
        if (parent.parentClientId) {
          return err(failure('validation', 'A hierarquia aceita um nível: rede e filial.'));
        }
      }

      const client = await repository.insert(input);

      await audit.record({
        organizationId: client.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'client.create',
        targetType: 'client',
        targetId: client.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { businessModel: client.businessModel, isBranch: Boolean(client.parentClientId) },
      });

      return ok(client);
    },

    async byId(organizationId, id) {
      const client = await repository.findById(organizationId, id);
      return client ? ok(client) : err(failure('not_found', 'Cliente não encontrado.'));
    },

    list: (organizationId) => repository.list(organizationId),
  };
}
