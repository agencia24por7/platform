import { withTenant } from '@/shared/db/tenant';
import type { ConfiguracaoDoComite, RepositorioDosComites } from '@/modules/strategy/application/portas';

type ConfiguracaoRow = { comite: string; ligado: boolean; atualizado_por: string | null; atualizado_em: Date };

export function createComitesRepository(): RepositorioDosComites {
  return {
    async listar(organizationId) {
      const rows = (await withTenant(organizationId, (tx) => tx`
        SELECT comite, ligado, atualizado_por, atualizado_em FROM core.strategy_committee_settings
         WHERE organization_id = ${organizationId} ORDER BY comite`)) as unknown as ConfiguracaoRow[];
      return rows.map(
        (row): ConfiguracaoDoComite => ({ comite: row.comite, ligado: row.ligado, atualizadoPor: row.atualizado_por, atualizadoEm: row.atualizado_em }),
      );
    },

    async definir(organizationId, comite, ligado) {
      await withTenant(organizationId, (tx) => tx`
        INSERT INTO core.strategy_committee_settings (organization_id, comite, ligado)
        VALUES (${organizationId}, ${comite}, ${ligado})
        ON CONFLICT (organization_id, comite) DO UPDATE SET ligado = EXCLUDED.ligado`);
    },
  };
}
