import { withTenant } from '@/shared/db/tenant';
import { SinalRecusadoPeloBanco, type NovoSinalDeCultura, type SinalDeCultura } from '../domain/cultura.ts';
import { paraSinalDeCultura, type LinhaDeSinal } from './culturaSql.ts';

export type EscopoDeCultura = { readonly organizationId: string; readonly clientId: string };

export const LIMITE_DA_LISTA_DE_SINAIS = 200;

export type InsercaoDeSinal = { readonly ok: true; readonly valor: SinalDeCultura } | { readonly ok: false; readonly motivo: 'duplicado' | 'cliente_inexistente' | 'sinal_invalido' };

export type ItemDoLote = { readonly id: string; readonly fonteUrl: string; readonly observadoEm: string; readonly repetido: boolean };

export type CulturaRepository = {
  inserir(escopo: EscopoDeCultura, dados: NovoSinalDeCultura): Promise<InsercaoDeSinal>;
  inserirLote(escopo: EscopoDeCultura, dados: readonly NovoSinalDeCultura[]): Promise<readonly ItemDoLote[]>;
  listar(escopo: EscopoDeCultura): Promise<readonly SinalDeCultura[]>;
  arquivar(escopo: EscopoDeCultura, sinalId: string): Promise<SinalDeCultura | null>;
};

function violacao(falha: unknown): { code?: string; constraint_name?: string } {
  return typeof falha === 'object' && falha !== null ? (falha as { code?: string; constraint_name?: string }) : {};
}

const recusadoPeloBanco = (falha: unknown): boolean => violacao(falha).code === '23514';

export function createCulturaRepository(): CulturaRepository {
  return {
    async inserir(escopo, dados) {
      try {
        return await withTenant(escopo.organizationId, async (tx) => {
          const cliente = (await tx`
            SELECT 1 AS ok FROM core.clients WHERE id = ${escopo.clientId} AND organization_id = ${escopo.organizationId}
          `) as unknown as unknown[];
          if (cliente.length === 0) return { ok: false, motivo: 'cliente_inexistente' } as const;
          const rows = (await tx`
            INSERT INTO core.client_culture_signals
              (organization_id, client_id, kind, titulo, resumo, fonte_url, fonte_nome, plataforma, observado_em, valido_ate, nota_evidencia, origem)
            VALUES (${escopo.organizationId}, ${escopo.clientId}, ${dados.tipo}, ${dados.titulo}, ${dados.resumo}, ${dados.fonteUrl}, ${dados.fonteNome},
                    ${dados.plataforma}, ${dados.observadoEm}::date, ${dados.validoAte}::date, ${dados.nota}, 'manual')
            RETURNING id, kind, titulo, resumo, fonte_url, fonte_nome, plataforma, observado_em::text AS observado_em,
                      valido_ate::text AS valido_ate, nota_evidencia, origem, criado_em
          `) as unknown as LinhaDeSinal[];
          return { ok: true, valor: paraSinalDeCultura(rows[0]!) } as const;
        });
      } catch (falha) {
        const erro = violacao(falha);
        if (erro.code === '23505' && erro.constraint_name === 'client_culture_signals_fonte_dia') return { ok: false, motivo: 'duplicado' };
        if (recusadoPeloBanco(falha)) return { ok: false, motivo: 'sinal_invalido' };
        throw falha;
      }
    },

    async inserirLote(escopo, dados) {
      return withTenant(escopo.organizationId, async (tx) => {
        const itens: ItemDoLote[] = [];
        for (const [indice, sinal] of dados.entries()) {
          const novos = (await tx`
            INSERT INTO core.client_culture_signals
              (organization_id, client_id, kind, titulo, resumo, fonte_url, fonte_nome, plataforma, observado_em, valido_ate, nota_evidencia, origem)
            VALUES (${escopo.organizationId}, ${escopo.clientId}, ${sinal.tipo}, ${sinal.titulo}, ${sinal.resumo}, ${sinal.fonteUrl}, ${sinal.fonteNome},
                    ${sinal.plataforma}, ${sinal.observadoEm}::date, ${sinal.validoAte}::date, ${sinal.nota}, 'coletor')
            ON CONFLICT (client_id, lower(fonte_url), observado_em) DO NOTHING
            RETURNING id
          `.catch((falha: unknown) => {
            throw recusadoPeloBanco(falha) ? new SinalRecusadoPeloBanco(indice) : falha;
          })) as unknown as { id: string }[];
          if (novos[0]) {
            itens.push({ id: novos[0].id, fonteUrl: sinal.fonteUrl, observadoEm: sinal.observadoEm, repetido: false });
            continue;
          }
          const existentes = (await tx`
            SELECT id FROM core.client_culture_signals
             WHERE client_id = ${escopo.clientId} AND organization_id = ${escopo.organizationId}
               AND lower(fonte_url) = lower(${sinal.fonteUrl}) AND observado_em = ${sinal.observadoEm}::date
          `) as unknown as { id: string }[];
          if (!existentes[0]) throw new Error('sinal repetido não encontrado');
          itens.push({ id: existentes[0].id, fonteUrl: sinal.fonteUrl, observadoEm: sinal.observadoEm, repetido: true });
        }
        return itens;
      });
    },

    async listar(escopo) {
      return withTenant(escopo.organizationId, async (tx) => {
        const rows = (await tx`
          SELECT id, kind, titulo, resumo, fonte_url, fonte_nome, plataforma, observado_em::text AS observado_em,
                 valido_ate::text AS valido_ate, nota_evidencia, origem, criado_em
            FROM core.client_culture_signals
           WHERE organization_id = ${escopo.organizationId} AND client_id = ${escopo.clientId} AND arquivado_em IS NULL
           ORDER BY valido_ate DESC, observado_em DESC, id
           LIMIT ${LIMITE_DA_LISTA_DE_SINAIS}
        `) as unknown as LinhaDeSinal[];
        return rows.map(paraSinalDeCultura);
      });
    },

    async arquivar(escopo, sinalId) {
      return withTenant(escopo.organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE core.client_culture_signals SET arquivado_em = now()
           WHERE id = ${sinalId} AND organization_id = ${escopo.organizationId} AND client_id = ${escopo.clientId} AND arquivado_em IS NULL
          RETURNING id, kind, titulo, resumo, fonte_url, fonte_nome, plataforma, observado_em::text AS observado_em,
                    valido_ate::text AS valido_ate, nota_evidencia, origem, criado_em
        `) as unknown as LinhaDeSinal[];
        return rows[0] ? paraSinalDeCultura(rows[0]) : null;
      });
    },
  };
}
