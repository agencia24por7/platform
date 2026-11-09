import type { Ator } from '@/modules/audit/domain/actor';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import {
  slugify,
  type NewOrganization,
  type Organization,
} from '@/modules/organizations/domain/organization';
import type { OrganizationRepository } from '@/modules/organizations/infrastructure/organizationRepository';

export type OrganizationService = {
  create(input: NewOrganization, ator: Ator): Promise<Result<Organization, Failure>>;
  byId(id: string): Promise<Result<Organization, Failure>>;
  byIds(ids: readonly string[]): Promise<readonly Organization[]>;
  exists(): Promise<boolean>;
  changeType(id: string, type: Organization['type'], ator: Ator): Promise<Result<Organization, Failure>>;
};

export function createOrganizationService(
  repository: OrganizationRepository,
  audit: AuditRecorder,
): OrganizationService {
  return {
    async create(input, ator) {
      const slug = slugify(input.name);
      if (slug.length < 3) {
        return err(failure('validation', 'Nome curto demais para gerar identificador.'));
      }

      if (await repository.findBySlug(slug)) {
        return err(failure('conflict', 'Já existe uma organização com esse nome.'));
      }

      const organization = await repository.insert({ ...input, slug });

      await audit.record({
        organizationId: organization.id,
        actorType: 'user',
        actorId: ator.userId,
        action: 'organization.create',
        targetType: 'organization',
        targetId: organization.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { type: organization.type, hasManagerAccount: Boolean(organization.managerAccountId) },
      });

      return ok(organization);
    },

    async byId(id) {
      const organization = await repository.findById(id);
      return organization ? ok(organization) : err(failure('not_found', 'Organização não encontrada.'));
    },

    byIds: (ids) => repository.byIds(ids),

    exists: async () => (await repository.count()) > 0,

    async changeType(id, type, ator) {
      const atual = await repository.findById(id);
      if (!atual) return err(failure('not_found', 'Organização não encontrada.'));
      if (atual.type === type) return ok(atual);

      const alterada = await repository.updateType(id, type);

      await audit.record({
        organizationId: id,
        actorType: 'user',
        actorId: ator.userId,
        action: 'organization.type_changed',
        targetType: 'organization',
        targetId: id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { de: atual.type, para: type },
      });

      return ok(alterada);
    },
  };
}
