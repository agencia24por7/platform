import type { Sql } from '@/shared/db/client';
import { sql } from '@/shared/db/client';

export type TenantSession = Sql;

export async function withTenant<T>(
  organizationId: string,
  work: (tx: TenantSession) => Promise<T>,
): Promise<T> {
  return sql().begin(async (tx) => {
    await tx`SELECT set_config('app.organization_id', ${organizationId}, true)`;
    return work(tx as unknown as TenantSession);
  }) as Promise<T>;
}

export async function withoutTenant<T>(work: (tx: TenantSession) => Promise<T>): Promise<T> {
  return sql().begin(async (tx) => {
    await tx`SELECT set_config('app.organization_id', '', true)`;
    return work(tx as unknown as TenantSession);
  }) as Promise<T>;
}
