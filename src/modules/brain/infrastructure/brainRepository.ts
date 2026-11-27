import { sql } from '@/shared/db/client';
import { withTenant } from '@/shared/db/tenant';
import type { BrainRepository, ClienteResolvido, EstadoDaPublicacao } from '../application/portas.ts';
import type { EntradaDeConhecimento } from '../domain/conhecimento.ts';
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
type ConhecimentoRow = {
  key: string;
  version: number;
  categoria: EntradaDeConhecimento['categoria'];
  titulo: string;
  resumo: string;
  fonte: string;
  nota: EntradaDeConhecimento['nota'];
  maturidade: EntradaDeConhecimento['maturidade'];
  mercado: string;
  jurisdicao: string;
  data_da_fonte: string;
  valido_ate: string | null;
  verificado_em: string | null;
  obrigatoria: boolean;
  replicada: boolean;
  created_at: Date;
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

    async carregarConhecimento(cliente): Promise<readonly EntradaDeConhecimento[]> {
      const rows = (await withTenant(cliente.organizationId, (tx) => tx`
        SELECT key, version, categoria, titulo, resumo, fonte, nota, maturidade, mercado, jurisdicao,
               data_da_fonte::text AS data_da_fonte, valido_ate::text AS valido_ate, verificado_em::text AS verificado_em,
               obrigatoria, replicada, created_at
        FROM (
          SELECT DISTINCT ON (key) *
          FROM core.knowledge_entries
          ORDER BY key, version DESC
        ) ultimas
        WHERE ativa
        ORDER BY key`)) as unknown as ConhecimentoRow[];
      return rows.map((row) => ({
        key: row.key,
        version: row.version,
        categoria: row.categoria,
        titulo: row.titulo,
        resumo: row.resumo,
        fonte: row.fonte,
        nota: row.nota,
        maturidade: row.maturidade,
        mercado: row.mercado,
        jurisdicao: row.jurisdicao,
        dataDaFonte: row.data_da_fonte,
        validoAte: row.valido_ate,
        verificadoEm: row.verificado_em,
        obrigatoria: row.obrigatoria,
        replicada: row.replicada,
        criadaEm: row.created_at,
      }));
    },

    async gravarDesempenho(cliente, medicao) {
      await withTenant(cliente.organizationId, async (tx) => {
        for (const linha of medicao.linhas) {
          await tx`
            INSERT INTO core.client_brain_performance
              (client_id, organization_id, platform, periodo, recorte, item, rotulo, investimento_centavos, impressoes, cliques,
               conversoes, receita_centavos, moeda, medido_em)
            VALUES (${cliente.clienteId}, ${cliente.organizationId}, ${linha.platform}, ${linha.periodo}, ${linha.recorte}, ${linha.chave},
                    ${linha.rotulo}, ${linha.investimentoCentavos}, ${linha.impressoes}, ${linha.cliques}, ${linha.conversoes},
                    ${linha.receitaCentavos}, ${linha.moeda}, now())
            ON CONFLICT (client_id, platform, periodo, recorte, item) DO UPDATE SET
              rotulo = EXCLUDED.rotulo, investimento_centavos = EXCLUDED.investimento_centavos, impressoes = EXCLUDED.impressoes,
              cliques = EXCLUDED.cliques, conversoes = EXCLUDED.conversoes, receita_centavos = EXCLUDED.receita_centavos,
              moeda = EXCLUDED.moeda, medido_em = now()
            WHERE (core.client_brain_performance.rotulo, core.client_brain_performance.investimento_centavos,
                   core.client_brain_performance.impressoes, core.client_brain_performance.cliques,
                   core.client_brain_performance.conversoes, core.client_brain_performance.receita_centavos,
                   core.client_brain_performance.moeda)
              IS DISTINCT FROM
                  (EXCLUDED.rotulo, EXCLUDED.investimento_centavos, EXCLUDED.impressoes, EXCLUDED.cliques,
                   EXCLUDED.conversoes, EXCLUDED.receita_centavos, EXCLUDED.moeda)`;
        }
        for (const escopo of medicao.medidos) {
          const chaves = medicao.linhas
            .filter((l) => l.platform === escopo.platform && l.recorte === escopo.recorte)
            .map((l) => `${l.periodo}|${l.chave}`);
          await tx`
            DELETE FROM core.client_brain_performance
            WHERE client_id = ${cliente.clienteId} AND organization_id = ${cliente.organizationId}
              AND platform = ${escopo.platform} AND recorte = ${escopo.recorte}
              AND NOT ((periodo::text || '|' || item) = ANY(${chaves}::text[]))`;
        }
      });
    },
  };
}
