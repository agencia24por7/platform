import type { Sql } from '@/shared/db/client';
import { sql } from '@/shared/db/client';
import { escopoDeCliente, usuarioDaSessao } from '@/shared/db/escopo';

export type TenantSession = Sql;

export async function withTenant<T>(
  organizationId: string,
  work: (tx: TenantSession) => Promise<T>,
): Promise<T> {
  const [escopo, userId] = await Promise.all([escopoDeCliente(organizationId), usuarioDaSessao()]);

  return sql().begin(async (tx) => {
    await tx`SELECT set_config('app.organization_id', ${organizationId}, true)`;
    await tx`SELECT set_config('app.client_ids', ${escopo}, true)`;
    await tx`SELECT set_config('app.user_id', ${userId}, true)`;
    return work(tx as unknown as TenantSession);
  }) as Promise<T>;
}

export async function withoutTenant<T>(work: (tx: TenantSession) => Promise<T>): Promise<T> {
  const userId = await usuarioDaSessao();

  return sql().begin(async (tx) => {
    await tx`SELECT set_config('app.organization_id', '', true)`;
    await tx`SELECT set_config('app.client_ids', '', true)`;
    await tx`SELECT set_config('app.user_id', ${userId}, true)`;
    return work(tx as unknown as TenantSession);
  }) as Promise<T>;
}
