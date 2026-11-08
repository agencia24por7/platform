import { withoutTenant } from '@/shared/db/tenant';
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
  findBySlug(slug: string): Promise<Organization | null>;
  findById(id: string): Promise<Organization | null>;
  list(): Promise<readonly Organization[]>;
};

export function createOrganizationRepository(): OrganizationRepository {
  return {
    async insert(input) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          INSERT INTO core.organizations (name, slug, type, manager_account_id, business_manager_id, developer_token_ref)
          VALUES (${input.name}, ${input.slug}, ${input.type}, ${input.managerAccountId},
                  ${input.businessManagerId}, ${input.developerTokenRef})
          RETURNING *`) as unknown as Row[];
        return toOrganization(rows[0]!);
      });
    },

    async findBySlug(slug) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`SELECT * FROM core.organizations WHERE slug = ${slug}`) as unknown as Row[];
        return rows[0] ? toOrganization(rows[0]) : null;
      });
    },

    async findById(id) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`SELECT * FROM core.organizations WHERE id = ${id}`) as unknown as Row[];
        return rows[0] ? toOrganization(rows[0]) : null;
      });
    },

    async list() {
      return withoutTenant(async (tx) => {
        const rows = (await tx`SELECT * FROM core.organizations ORDER BY created_at ASC`) as unknown as Row[];
        return rows.map(toOrganization);
      });
    },
  };
}
