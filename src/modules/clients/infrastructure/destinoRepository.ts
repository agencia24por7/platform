import { withTenant } from '@/shared/db/tenant';
import type { LandingPage } from '@/modules/clients/domain/destino/tipos';

type LandingPageRow = {
  id: string;
  organization_id: string;
  client_id: string;
  url: string;
  rotulo: string;
  criada_em: Date;
  arquivada_em: Date | null;
};

const paraLandingPage = (row: LandingPageRow): LandingPage => ({
  id: row.id,
  organizationId: row.organization_id,
  clientId: row.client_id,
  url: row.url,
  rotulo: row.rotulo,
  criadaEm: row.criada_em,
  arquivadaEm: row.arquivada_em,
});

export type EscopoDeDestino = { readonly organizationId: string; readonly clientId: string };

export type InsercaoDeLandingPage = { readonly ok: true; readonly valor: LandingPage } | { readonly ok: false; readonly motivo: 'url_duplicada' | 'cliente_inexistente' };

export type DestinoRepository = {
  inserirLandingPage(escopo: EscopoDeDestino, dados: { url: string; rotulo: string }): Promise<InsercaoDeLandingPage>;
  listarLandingPages(escopo: EscopoDeDestino, incluirArquivadas: boolean): Promise<readonly LandingPage[]>;
  arquivarLandingPage(escopo: EscopoDeDestino, landingPageId: string): Promise<LandingPage | null>;
  lerWhatsapp(escopo: EscopoDeDestino): Promise<{ readonly existe: boolean; readonly whatsapp: string | null }>;
  gravarWhatsapp(escopo: EscopoDeDestino, whatsapp: string | null): Promise<boolean>;
};

function violacao(falha: unknown): { code?: string; constraint_name?: string } {
  return typeof falha === 'object' && falha !== null ? (falha as { code?: string; constraint_name?: string }) : {};
}

export function createDestinoRepository(): DestinoRepository {
  return {
    async inserirLandingPage(escopo, dados) {
      try {
        return await withTenant(escopo.organizationId, async (tx) => {
          const cliente = (await tx`
            SELECT 1 AS ok FROM core.clients WHERE id = ${escopo.clientId} AND organization_id = ${escopo.organizationId}
          `) as unknown as unknown[];
          if (cliente.length === 0) return { ok: false, motivo: 'cliente_inexistente' } as const;
          const rows = (await tx`
            INSERT INTO core.client_landing_pages (organization_id, client_id, url, rotulo)
            VALUES (${escopo.organizationId}, ${escopo.clientId}, ${dados.url}, ${dados.rotulo})
            RETURNING id, organization_id, client_id, url, rotulo, criada_em, arquivada_em
          `) as unknown as LandingPageRow[];
          return { ok: true, valor: paraLandingPage(rows[0]!) } as const;
        });
      } catch (falha) {
        const erro = violacao(falha);
        if (erro.code === '23505' && erro.constraint_name === 'client_landing_pages_url_ativa') return { ok: false, motivo: 'url_duplicada' };
        throw falha;
      }
    },

    async listarLandingPages(escopo, incluirArquivadas) {
      return withTenant(escopo.organizationId, async (tx) => {
        const rows = (await tx`
          SELECT id, organization_id, client_id, url, rotulo, criada_em, arquivada_em
            FROM core.client_landing_pages
           WHERE organization_id = ${escopo.organizationId} AND client_id = ${escopo.clientId}
             AND (${incluirArquivadas} OR arquivada_em IS NULL)
           ORDER BY criada_em DESC, id
        `) as unknown as LandingPageRow[];
        return rows.map(paraLandingPage);
      });
    },

    async arquivarLandingPage(escopo, landingPageId) {
      return withTenant(escopo.organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE core.client_landing_pages SET arquivada_em = now()
           WHERE id = ${landingPageId} AND organization_id = ${escopo.organizationId} AND client_id = ${escopo.clientId}
             AND arquivada_em IS NULL
          RETURNING id, organization_id, client_id, url, rotulo, criada_em, arquivada_em
        `) as unknown as LandingPageRow[];
        return rows[0] ? paraLandingPage(rows[0]) : null;
      });
    },

    async lerWhatsapp(escopo) {
      return withTenant(escopo.organizationId, async (tx) => {
        const rows = (await tx`
          SELECT whatsapp FROM core.clients WHERE id = ${escopo.clientId} AND organization_id = ${escopo.organizationId}
        `) as unknown as { whatsapp: string | null }[];
        return rows[0] ? { existe: true, whatsapp: rows[0].whatsapp } : { existe: false, whatsapp: null };
      });
    },

    async gravarWhatsapp(escopo, whatsapp) {
      return withTenant(escopo.organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE core.clients SET whatsapp = ${whatsapp}
           WHERE id = ${escopo.clientId} AND organization_id = ${escopo.organizationId} RETURNING id
        `) as unknown as unknown[];
        return rows.length > 0;
      });
    },
  };
}
