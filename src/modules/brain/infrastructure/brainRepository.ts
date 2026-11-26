import { sql } from '@/shared/db/client';
import { withTenant } from '@/shared/db/tenant';
import type { BrainRepository, ClienteResolvido, EstadoDaPublicacao } from '../application/portas.ts';
import type { InventarioDoCliente } from '../domain/inventario.ts';
import { consultarInventario, montarInventario } from './inventarioSql.ts';

type ResolvidoRow = { organization_id: string; client_id: string };
type EstadoRow = {
  publicado_em: Date | null;
  ultimo_hash: string | null;
  pendente: boolean;
  ultima_tentativa_em: Date | null;
  ultimo_erro: string | null;
  tentativas: number;
};
type ParaMedirRow = ResolvidoRow & { plataformas: string[] };

const resolvido = (row: ResolvidoRow): ClienteResolvido => ({ organizationId: row.organization_id, clienteId: row.client_id });
const limite = (valor: number, maximo: number) => Math.max(1, Math.min(Math.trunc(valor), maximo));

export function createBrainRepository(): BrainRepository {
  return {
    async resolverCliente(clienteId) {
      const rows = (await sql()`SELECT * FROM core.brain_resolver_cliente(${clienteId}::uuid)`) as unknown as ResolvidoRow[];
      return rows[0] ? resolvido(rows[0]) : null;
    },

    async clienteVivo(cliente) {
      const rows = (await withTenant(cliente.organizationId, (tx) => tx`
        SELECT 1 FROM core.clients c
          JOIN core.organizations o ON o.id = c.organization_id
         WHERE c.id = ${cliente.clienteId}::uuid AND c.organization_id = ${cliente.organizationId}::uuid
           AND c.excluido_em IS NULL AND o.status <> 'archived'`)) as unknown as unknown[];
      return rows.length === 1;
    },

    async carregarInventario(cliente): Promise<InventarioDoCliente | null> {
      const linhas = await withTenant(cliente.organizationId, (tx) => consultarInventario(tx, cliente));
      return montarInventario(linhas);
    },

    async estado(cliente): Promise<EstadoDaPublicacao | null> {
      const rows = (await withTenant(cliente.organizationId, (tx) => tx`
        SELECT publicado_em, ultimo_hash, pendente, ultima_tentativa_em, ultimo_erro, tentativas
        FROM core.client_brain_catalog_state WHERE client_id = ${cliente.clienteId}`)) as unknown as EstadoRow[];
      const row = rows[0];
      if (!row) return null;
      return {
        publicadoEm: row.publicado_em,
        ultimoHash: row.ultimo_hash,
        pendente: row.pendente,
        ultimaTentativaEm: row.ultima_tentativa_em,
        ultimoErro: row.ultimo_erro,
        tentativas: row.tentativas,
      };
    },

    async registrarPublicacao(cliente, publicacao) {
      await withTenant(cliente.organizationId, (tx) => tx`
        INSERT INTO core.client_brain_catalog_state
          (client_id, organization_id, pendente, motivo, publicado_em, ultimo_hash, entradas, ultima_tentativa_em, ultimo_erro, tentativas, atualizado_em)
        VALUES (${cliente.clienteId}, ${cliente.organizationId}, false, NULL, now(), ${publicacao.hash}, ${publicacao.entradas}, now(), NULL, 0, now())
        ON CONFLICT (client_id) DO UPDATE SET
          pendente = false, motivo = NULL, publicado_em = now(), ultimo_hash = EXCLUDED.ultimo_hash, entradas = EXCLUDED.entradas,
          ultima_tentativa_em = now(), ultimo_erro = NULL, tentativas = 0, atualizado_em = now()`);
    },

    async registrarFalha(cliente, erro) {
      await withTenant(cliente.organizationId, (tx) => tx`
        INSERT INTO core.client_brain_catalog_state (client_id, organization_id, pendente, ultima_tentativa_em, ultimo_erro, tentativas)
        VALUES (${cliente.clienteId}, ${cliente.organizationId}, true, now(), ${erro.slice(0, 500)}, 1)
        ON CONFLICT (client_id) DO UPDATE SET
          pendente = true, ultima_tentativa_em = now(), ultimo_erro = EXCLUDED.ultimo_erro,
          tentativas = core.client_brain_catalog_state.tentativas + 1, atualizado_em = now()`);
    },

    async marcarPendente(cliente, motivo) {
      await withTenant(cliente.organizationId, (tx) => tx`
        INSERT INTO core.client_brain_catalog_state (client_id, organization_id, pendente, motivo, solicitado_em)
        VALUES (${cliente.clienteId}, ${cliente.organizationId}, true, ${motivo.slice(0, 80)}, now())
        ON CONFLICT (client_id) DO UPDATE SET pendente = true, motivo = EXCLUDED.motivo, solicitado_em = now(), atualizado_em = now()`);
    },

    async clientesParaPublicar(maximo) {
      const rows = (await sql()`SELECT * FROM core.brain_clientes_para_publicar(${limite(maximo, 500)})`) as unknown as ResolvidoRow[];
      return rows.map(resolvido);
    },

    async clientesExcluidosPublicados(maximo) {
      const rows = (await sql()`SELECT * FROM core.brain_clientes_excluidos_publicados(${limite(maximo, 500)})`) as unknown as ResolvidoRow[];
      return rows.map(resolvido);
    },

    async marcarDespublicado(clienteId) {
      await sql()`SELECT core.brain_marcar_despublicado(${clienteId}::uuid)`;
    },

    async clientesParaMedir(maximo) {
      const rows = (await sql()`SELECT * FROM core.brain_clientes_para_medir(${limite(maximo, 200)})`) as unknown as ParaMedirRow[];
      return rows.map((row) => ({ ...resolvido(row), plataformas: row.plataformas }));
    },

    async gravarCobertura(cliente, medidas) {
      if (medidas.length === 0) return;
      await withTenant(cliente.organizationId, async (tx) => {
        for (const medida of medidas) {
          await tx`
            INSERT INTO core.client_brain_coverage (client_id, organization_id, tabela, desde, ate, linhas, dias_com_dado, medido_em)
            VALUES (${cliente.clienteId}, ${cliente.organizationId}, ${medida.tabela}, ${medida.desde}, ${medida.ate}, ${medida.linhas}, ${medida.diasComDado}, now())
            ON CONFLICT (client_id, tabela) DO UPDATE SET
              desde = EXCLUDED.desde, ate = EXCLUDED.ate, linhas = EXCLUDED.linhas, dias_com_dado = EXCLUDED.dias_com_dado, medido_em = now()`;
        }
      });
    },
  };
}
