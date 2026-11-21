import { sql } from '@/shared/db/client';
import { withTenant } from '@/shared/db/tenant';
import type { AcessosCompartilhados } from '@/modules/privacidade/application/revogacaoNoProvedor';
import type { ExpurgoPendente, FilaDeExpurgo, ResumoDaPreparacao } from '@/modules/privacidade/application/expurgoDeFontes';
import type {
  PedidoNaOrganizacao,
  PedidosDeExclusaoRepository,
  SituacaoDoPedido,
} from '@/modules/privacidade/application/pedidosDeExclusao';

type PendenteRow = { id: string; organization_id: string; platform: string; external_id: string };

const paraPendente = (row: PendenteRow): ExpurgoPendente => ({
  id: row.id,
  organizationId: row.organization_id,
  platform: row.platform,
  externalId: row.external_id,
});

export function createFilaDeExpurgo(): FilaDeExpurgo {
  return {
    async enfileirarDaConexao(organizationId, connectionId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`SELECT * FROM privacidade.enfileirar_expurgo_da_conexao(${connectionId})`) as unknown as PendenteRow[];
        return rows.map(paraPendente);
      });
    },

    async prepararConformidadeDoYoutube() {
      const rows = (await sql()`SELECT privacidade.preparar_conformidade_youtube() AS resumo`) as unknown as { resumo: ResumoDaPreparacao }[];
      return rows[0]!.resumo;
    },

    async vencidos(limite) {
      const rows = (await sql()`SELECT * FROM privacidade.expurgos_de_fonte_vencidos(${limite})`) as unknown as PendenteRow[];
      return rows.map(paraPendente);
    },

    async registrarResultado(id, erro) {
      await sql()`SELECT privacidade.registrar_resultado_do_expurgo(${id}, ${erro})`;
    },
  };
}

export function createAcessosCompartilhados(): AcessosCompartilhados {
  return {
    async compartilhado(organizationId, connectionId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`SELECT integrations.acesso_compartilhado(${connectionId}) AS compartilhado`) as unknown as {
          compartilhado: boolean;
        }[];
        return rows[0]?.compartilhado === true;
      });
    },
  };
}

type SituacaoRow = { situacao: SituacaoDoPedido['situacao']; criado_em: Date; concluido_em: Date | null };
type RegistroRow = { codigo: string; situacao: SituacaoDoPedido['situacao']; novo: boolean };
type NaOrganizacaoRow = { codigo: string; situacao: SituacaoDoPedido['situacao']; criado_em: Date; connection_id: string };

export function createPedidosDeExclusaoRepository(): PedidosDeExclusaoRepository {
  return {
    async registrarDaMeta(input) {
      const rows = (await sql()`
        SELECT * FROM privacidade.registrar_pedido_de_exclusao_meta(
          ${input.usuarioHash}, ${input.usuarioHashesAnteriores as string[]}::text[], ${input.usuarioExterno}, ${input.codigo})
      `) as unknown as RegistroRow[];
      const row = rows[0]!;
      return { codigo: row.codigo, situacao: row.situacao, novo: row.novo };
    },

    async situacao(codigo) {
      const rows = (await sql()`SELECT * FROM privacidade.situacao_do_pedido_de_exclusao(${codigo})`) as unknown as SituacaoRow[];
      const row = rows[0];
      return row ? { situacao: row.situacao, criadoEm: row.criado_em, concluidoEm: row.concluido_em } : null;
    },

    async abertosDaOrganizacao(organizationId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT p.codigo_de_confirmacao AS codigo, p.status AS situacao, p.criado_em, l.connection_id
            FROM privacidade.pedidos_de_exclusao_conexoes l
            JOIN privacidade.pedidos_de_exclusao p ON p.id = l.pedido_id
           WHERE p.status <> 'concluido'
           ORDER BY p.criado_em`) as unknown as NaOrganizacaoRow[];
        return rows.map(
          (row): PedidoNaOrganizacao => ({ codigo: row.codigo, situacao: row.situacao, criadoEm: row.criado_em, connectionId: row.connection_id }),
        );
      });
    },
  };
}
