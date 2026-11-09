import type { Sql } from '@/shared/db/client';
import { sql } from '@/shared/db/client';
import { ORGANIZACAO_INTEIRA, escopoDeCliente } from '@/shared/db/escopo';

export type TenantSession = Sql;

export async function withTenant<T>(
  organizationId: string,
  work: (tx: TenantSession) => Promise<T>,
): Promise<T> {
  const escopo = await escopoDeCliente(organizationId);

  return sql().begin(async (tx) => {
    await tx`SELECT set_config('app.organization_id', ${organizationId}, true)`;
    await tx`SELECT set_config('app.client_ids', ${escopo}, true)`;
    return work(tx as unknown as TenantSession);
  }) as Promise<T>;
}

export async function withFullTenant<T>(
  organizationId: string,
  work: (tx: TenantSession) => Promise<T>,
): Promise<T> {
  return sql().begin(async (tx) => {
    await tx`SELECT set_config('app.organization_id', ${organizationId}, true)`;
    await tx`SELECT set_config('app.client_ids', ${ORGANIZACAO_INTEIRA}, true)`;
    return work(tx as unknown as TenantSession);
  }) as Promise<T>;
}

export async function withoutTenant<T>(work: (tx: TenantSession) => Promise<T>): Promise<T> {
  return sql().begin(async (tx) => {
    await tx`SELECT set_config('app.organization_id', '', true)`;
    await tx`SELECT set_config('app.client_ids', '', true)`;
    return work(tx as unknown as TenantSession);
  }) as Promise<T>;
}
