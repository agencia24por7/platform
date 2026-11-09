import { withTenant, withoutTenant } from '@/shared/db/tenant';
import type { NewOrganization, Organization } from '@/modules/organizations/domain/organization';

type Row = {
  id: string;
  name: string;
  slug: string;
  type: Organization['type'];
  manager_account_id: string | null;
  business_manager_id: string | null;
  developer_token_ref: string | null;
  created_at: Date;
};

const toOrganization = (row: Row): Organization => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  type: row.type,
  managerAccountId: row.manager_account_id,
  businessManagerId: row.business_manager_id,
  developerTokenRef: row.developer_token_ref,
  createdAt: row.created_at,
});

export type OrganizationRepository = {
  insert(input: NewOrganization & { slug: string }): Promise<Organization>;
  slugTaken(slug: string): Promise<boolean>;
  findById(id: string): Promise<Organization | null>;
  ofUser(userId: string): Promise<readonly Organization[]>;
  exists(): Promise<boolean>;
  updateType(id: string, type: Organization['type']): Promise<Organization>;
};

export function createOrganizationRepository(): OrganizationRepository {
  return {
    async insert(input) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT * FROM core.create_organization(
            ${input.name}, ${input.slug}, ${input.type}::core.organization_type,
            ${input.managerAccountId}, ${input.businessManagerId}, ${input.developerTokenRef})
        `) as unknown as Row[];
        return toOrganization(rows[0]!);
      });
    },

    async slugTaken(slug) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`SELECT core.slug_taken(${slug}) AS tomado`) as unknown as { tomado: boolean }[];
        return rows[0]?.tomado === true;
      });
    },

    async findById(id) {
      return withTenant(id, async (tx) => {
        const rows = (await tx`SELECT * FROM core.organizations WHERE id = ${id}`) as unknown as Row[];
        return rows[0] ? toOrganization(rows[0]) : null;
      });
    },

    async updateType(id, type) {
      return withTenant(id, async (tx) => {
        const rows = (await tx`
          UPDATE core.organizations SET type = ${type} WHERE id = ${id} RETURNING *`) as unknown as Row[];
        return toOrganization(rows[0]!);
      });
    },

    async ofUser(userId) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`SELECT * FROM core.organizations_of(${userId})`) as unknown as Row[];
        return rows.map(toOrganization);
      });
    },

    async exists() {
      return withoutTenant(async (tx) => {
        const rows = (await tx`SELECT core.any_organization_exists() AS existe`) as unknown as { existe: boolean }[];
        return rows[0]?.existe === true;
      });
    },
  };
}
