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
  create(input: NewOrganization, actorId: string, requestId: string): Promise<Result<Organization, Failure>>;
  byId(id: string): Promise<Result<Organization, Failure>>;
  list(): Promise<readonly Organization[]>;
};

export function createOrganizationService(
  repository: OrganizationRepository,
  audit: AuditRecorder,
): OrganizationService {
  return {
    async create(input, actorId, requestId) {
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
        actorId,
        action: 'organization.create',
        targetType: 'organization',
        targetId: organization.id,
        requestId,
        metadata: { type: organization.type, hasManagerAccount: Boolean(organization.managerAccountId) },
      });

      return ok(organization);
    },

    async byId(id) {
      const organization = await repository.findById(id);
      return organization ? ok(organization) : err(failure('not_found', 'Organização não encontrada.'));
    },

    list: () => repository.list(),
  };
}
