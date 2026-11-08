import { modules } from '@/composition';
import type { Organization } from '@/modules/organizations/domain/organization';

export async function currentOrganization(): Promise<Organization | null> {
  const organizations = await modules().organizations.list();
  return organizations[0] ?? null;
}
