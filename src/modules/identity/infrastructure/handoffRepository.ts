import { withoutTenant } from '@/shared/db/tenant';

export type HandoffRepository = {
  consume(jti: string, expiresAt: Date): Promise<boolean>;
};

export function createHandoffRepository(): HandoffRepository {
  return {
    async consume(jti, expiresAt) {
      return withoutTenant(async (tx) => {
        await tx`DELETE FROM core.handoff_consumed WHERE expires_at < now()`;

        const rows = (await tx`
          INSERT INTO core.handoff_consumed (jti, expires_at)
          VALUES (${jti}, ${expiresAt})
          ON CONFLICT (jti) DO NOTHING
          RETURNING jti`) as unknown as { jti: string }[];

        return rows.length === 1;
      });
    },
  };
}
