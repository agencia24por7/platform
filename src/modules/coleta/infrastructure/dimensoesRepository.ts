import { sql } from '@/shared/db/client';
import type { EstadoDaFonte, EstadoDoCliente, MudancaDePosse, OrigemDaFonte } from '@/modules/coleta/domain/dimensoes';

type FonteRow = {
  organization_id: string;
  platform: string;
  external_id: string;
  origem: OrigemDaFonte;
  client_id: string | null;
  status: string;
  nome: string | null;
};

type ClienteRow = {
  organization_id: string;
  client_id: string;
  nome: string;
  status: string;
  parent_client_id: string | null;
  business_model: string;
};

type MudancaRow = {
  organization_id: string;
  platform: string;
  external_id: string;
  em: Date;
  dono_conhecido: boolean;
  client_id_anterior: string | null;
  status_anterior: string;
};

export type DimensoesRepository = {
  fontes(): Promise<readonly EstadoDaFonte[]>;
  clientes(): Promise<readonly EstadoDoCliente[]>;
  mudancasDePosse(): Promise<readonly MudancaDePosse[]>;
};

export function createDimensoesRepository(): DimensoesRepository {
  return {
    async fontes() {
      const rows = (await sql()`SELECT * FROM automation.dimensao_fontes()`) as unknown as FonteRow[];
      return rows.map((row) => ({
        organizationId: row.organization_id,
        platform: row.platform,
        externalId: row.external_id,
        origem: row.origem,
        clientId: row.client_id,
        status: row.status,
        nome: row.nome,
      }));
    },

    async clientes() {
      const rows = (await sql()`SELECT * FROM automation.dimensao_clientes()`) as unknown as ClienteRow[];
      return rows.map((row) => ({
        organizationId: row.organization_id,
        clientId: row.client_id,
        nome: row.nome,
        status: row.status,
        parentClientId: row.parent_client_id,
        businessModel: row.business_model,
      }));
    },

    async mudancasDePosse() {
      const rows = (await sql()`SELECT * FROM automation.dimensao_mudancas_de_posse()`) as unknown as MudancaRow[];
      return rows.map((row) => ({
        organizationId: row.organization_id,
        platform: row.platform,
        externalId: row.external_id,
        em: row.em,
        antes: row.dono_conhecido ? { clientId: row.client_id_anterior, status: row.status_anterior } : null,
      }));
    },
  };
}
