import { sql } from '@/shared/db/client';
import { withTenant } from '@/shared/db/tenant';
import type { CredencialRepository } from '../application/credencialService.ts';
import type { CredencialDeAgente } from '../domain/credencial.ts';

type CredencialRow = {
  id: string;
  organization_id: string;
  name: string;
  token_label: string;
  client_ids: string[] | null;
  tools: string[];
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  last_used_at: Date | null;
};

type EscopoRow = { credential_id: string; organization_id: string; client_ids: string[] | null; tools: string[] };

function credencial(row: CredencialRow): CredencialDeAgente {
  return {
    id: row.id,
    organizationId: row.organization_id,
    nome: row.name,
    rotulo: row.token_label,
    clienteIds: row.client_ids,
    ferramentas: row.tools,
    venceEm: row.expires_at,
    revogadaEm: row.revoked_at,
    criadaEm: row.created_at,
    ultimoUsoEm: row.last_used_at,
  };
}

export function createCredencialRepository(): CredencialRepository {
  return {
    async inserirSeCouber(nova, tetoDeVivas) {
      const rows = (await withTenant(nova.organizationId, async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`agent_credentials:${nova.organizationId}`}))`;
        const vivas = (await tx`
          SELECT count(*)::int AS total FROM core.agent_credentials
           WHERE organization_id = ${nova.organizationId} AND revoked_at IS NULL AND expires_at > now()`) as unknown as { total: number }[];
        if ((vivas[0]?.total ?? 0) >= tetoDeVivas) return [];
        return tx`
        INSERT INTO core.agent_credentials
          (organization_id, name, token_hash, token_label, client_ids, tools, expires_at, created_by)
        VALUES (${nova.organizationId}, ${nova.nome}, ${nova.tokenHash}, ${nova.rotulo},
                ${nova.clienteIds ? [...nova.clienteIds] : null}::uuid[], ${[...nova.ferramentas]}::text[],
                now() + make_interval(days => ${nova.validadeEmDias}::int), ${nova.criadaPor})
        RETURNING id, organization_id, name, token_label, client_ids, tools, expires_at, revoked_at, created_at, last_used_at`;
      })) as unknown as CredencialRow[];
      return rows[0] ? credencial(rows[0]) : null;
    },

    async listar(organizationId) {
      const rows = (await withTenant(organizationId, (tx) => tx`
        SELECT id, organization_id, name, token_label, client_ids, tools, expires_at, revoked_at, created_at, last_used_at
          FROM core.agent_credentials
         WHERE organization_id = ${organizationId}
         ORDER BY created_at DESC
         LIMIT 200`)) as unknown as CredencialRow[];
      return rows.map(credencial);
    },

    async clientesVivos(organizationId, clienteIds) {
      const rows = (await withTenant(organizationId, (tx) => tx`
        SELECT id FROM core.clients
         WHERE organization_id = ${organizationId} AND excluido_em IS NULL AND id = ANY(${[...clienteIds]}::uuid[])`)) as unknown as { id: string }[];
      return rows.map((row) => row.id);
    },

    async revogar(organizationId, credencialId) {
      const rows = (await withTenant(organizationId, (tx) => tx`
        UPDATE core.agent_credentials SET revoked_at = now()
         WHERE id = ${credencialId} AND organization_id = ${organizationId} AND revoked_at IS NULL
        RETURNING id, organization_id, name, token_label, client_ids, tools, expires_at, revoked_at, created_at, last_used_at`)) as unknown as CredencialRow[];
      return rows[0] ? credencial(rows[0]) : null;
    },

    async resolver(tokenHash) {
      const rows = (await sql()`SELECT credential_id, organization_id, client_ids, tools FROM core.agente_resolver(${tokenHash})`) as unknown as EscopoRow[];
      const row = rows[0];
      if (!row) return null;
      return { credencialId: row.credential_id, organizationId: row.organization_id, clienteIds: row.client_ids, ferramentas: row.tools };
    },
  };
}
