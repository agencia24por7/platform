import { RECORTES_DE_DESEMPENHO, type RecorteDeDesempenho } from '../domain/desempenho.ts';
import type { InventarioDoCliente, JanelaColetada, TipoDeFonte } from '../domain/inventario.ts';

export type LinhaDeCliente = {
  id: string;
  organization_id: string;
  name: string;
  parent_client_id: string | null;
  status: string;
  business_model: string;
  segment: string | null;
};

export type LinhaDeConexao = {
  id: string;
  platform: string;
  label: string;
  status: string;
  expires_at: Date | null;
  authorized_at: Date;
};

export type LinhaDeFonte = {
  fonte_tipo: TipoDeFonte;
  id: string;
  platform: string;
  external_id: string;
  nome: string;
  estado: string;
  vinculada: boolean;
  coleta_habilitada: boolean;
  connection_id: string;
  moeda: string | null;
  fuso: string | null;
};

export type LinhaDeColetas = {
  fonte_id: string;
  janelas_ok: string[];
  ultima_ok_em: Date | null;
  ultima_tentativa_em: Date | null;
  ultimo_status: string | null;
  parciais_recentes: number;
  pausada_ate: Date | null;
  falhas: Record<string, number> | null;
  avisos: Record<string, number> | null;
  faltantes: Record<string, number> | null;
};

export type LinhaDeCobertura = {
  tabela: string;
  desde: string | null;
  ate: string | null;
  linhas: string | number;
  dias_com_dado: number | null;
  medido_em: Date;
};

export type LinhaSqlDeDesempenho = {
  platform: string;
  periodo: string;
  recorte: string;
  chave: string;
  rotulo: string;
  investimento_centavos: string | number;
  impressoes: string | number;
  cliques: string | number;
  conversoes: string | number;
  receita_centavos: string | number | null;
  moeda: string;
  medido_em: Date;
};

export type LinhasDoInventario = {
  clientes: LinhaDeCliente[];
  conexoes: LinhaDeConexao[];
  fontes: LinhaDeFonte[];
  coletas: LinhaDeColetas[];
  cobertura: LinhaDeCobertura[];
  desempenho: LinhaSqlDeDesempenho[];
};

export type ExecutorSql = (partes: TemplateStringsArray, ...valores: string[]) => PromiseLike<readonly unknown[]>;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export function lerJanelas(janelas: readonly string[]): readonly JanelaColetada[] {
  return janelas
    .map((texto) => texto.split('|'))
    .filter((partes): partes is [string, string] => partes.length === 2 && DATA.test(partes[0]!) && DATA.test(partes[1]!))
    .map(([de, ate]) => ({ de, ate }))
    .sort((a, b) => a.de.localeCompare(b.de) || a.ate.localeCompare(b.ate));
}

function contagens(valor: Record<string, number> | null): Readonly<Record<string, number>> {
  if (!valor || typeof valor !== 'object') return {};
  return Object.fromEntries(
    Object.entries(valor)
      .filter(([chave, n]) => /^[a-z][a-z0-9_]{0,63}$/.test(chave) && Number.isFinite(Number(n)))
      .map(([chave, n]): [string, number] => [chave, Number(n)])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function montarInventario(linhas: LinhasDoInventario): InventarioDoCliente | null {
  const cliente = linhas.clientes[0];
  if (!cliente) return null;
  return {
    cliente: {
      id: cliente.id,
      organizationId: cliente.organization_id,
      nome: cliente.name,
      parentClientId: cliente.parent_client_id,
      status: cliente.status,
      modeloDeNegocio: cliente.business_model,
      segmento: cliente.segment,
    },
    conexoesDaOrganizacao: linhas.conexoes.map((c) => ({
      id: c.id,
      platform: c.platform,
      rotulo: c.label,
      status: c.status,
      expiraEm: c.expires_at,
      autorizadaEm: c.authorized_at,
    })),
    fontes: linhas.fontes.map((f) => ({
      id: f.id,
      fonteTipo: f.fonte_tipo,
      platform: f.platform,
      externalId: f.external_id,
      nome: f.nome,
      estado: f.estado,
      vinculada: f.vinculada,
      coletaHabilitada: f.coleta_habilitada,
      conexaoId: f.connection_id,
      moeda: f.moeda?.trim() || null,
      fuso: f.fuso,
    })),
    coletas: linhas.coletas.map((c) => ({
      fonteId: c.fonte_id,
      janelasOk: lerJanelas(c.janelas_ok ?? []),
      ultimaColetaOkEm: c.ultima_ok_em,
      ultimaTentativaEm: c.ultima_tentativa_em,
      ultimoStatus: c.ultimo_status,
      falhasRecentes: contagens(c.falhas),
      parciaisRecentes: Number(c.parciais_recentes ?? 0),
      avisosRecentes: contagens(c.avisos),
      faltantesRecentes: contagens(c.faltantes),
      pausadaAte: c.pausada_ate,
    })),
    cobertura: linhas.cobertura.map((m) => ({
      tabela: m.tabela,
      desde: m.desde,
      ate: m.ate,
      linhas: Number(m.linhas),
      diasComDado: m.dias_com_dado,
      medidoEm: m.medido_em,
    })),
    desempenho: linhas.desempenho
      .filter((d) => (RECORTES_DE_DESEMPENHO as readonly string[]).includes(d.recorte))
      .map((d) => ({
        platform: d.platform,
        periodo: d.periodo,
        recorte: d.recorte as RecorteDeDesempenho,
        chave: d.chave,
        rotulo: d.rotulo,
        investimentoCentavos: Number(d.investimento_centavos),
        impressoes: Number(d.impressoes),
        cliques: Number(d.cliques),
        conversoes: Number(d.conversoes),
        receitaCentavos: d.receita_centavos === null ? null : Number(d.receita_centavos),
        moeda: d.moeda.trim(),
        medidoEm: d.medido_em,
      })),
  };
}

export async function consultarInventario(tx: ExecutorSql, cliente: { readonly organizationId: string; readonly clienteId: string }): Promise<LinhasDoInventario> {
  const id = cliente.clienteId;
  const clientes = await tx`
    SELECT id, organization_id, name, parent_client_id, status::text AS status, business_model::text AS business_model, segment
    FROM core.clients WHERE id = ${id}`;
  if (clientes.length === 0) return { clientes: [], conexoes: [], fontes: [], coletas: [], cobertura: [], desempenho: [] };
  const conexoes = await tx`
    SELECT id, platform::text AS platform, label, status::text AS status, expires_at, authorized_at
    FROM integrations.connections WHERE organization_id = ${cliente.organizationId} ORDER BY id`;
  const fontes = await tx`
    SELECT 'ad_account' AS fonte_tipo, a.id, a.platform::text AS platform, a.external_id, a.name AS nome, a.status::text AS estado,
           (a.status = 'linked') AS vinculada, a.sync_enabled AS coleta_habilitada, a.connection_id, a.currency::text AS moeda, a.timezone AS fuso
    FROM integrations.ad_accounts a WHERE a.client_id = ${id}
    UNION ALL
    SELECT 'connection_account', ca.id, ca.platform::text, ca.external_id, ca.name, ca.state::text,
           (ca.state = 'linked' AND NOT ca.inactive), true, ca.connection_id, ca.currency::text, ca.timezone
    FROM integrations.connection_accounts ca WHERE ca.client_id = ${id} AND ca.ad_account_id IS NULL
    ORDER BY 2`;
  const coletas = await tx`
    WITH base AS (
      SELECT coalesce(c.ad_account_id, c.connection_account_id) AS fonte_id, c.status::text AS status, c.mode::text AS modo,
             c.window_start, c.window_end, c.started_at, c.finished_at, c.error_code, c.qualidade_resumo, c.pausa_ate
      FROM automation.coletas c
      WHERE c.client_id = ${id} AND c.started_at >= now() - interval '400 days'
    ),
    recentes AS (SELECT * FROM base WHERE started_at >= now() - interval '14 days'),
    falhas AS (
      SELECT fonte_id, jsonb_object_agg(error_code, n) AS mapa
      FROM (SELECT fonte_id, error_code, count(*) AS n FROM recentes WHERE status = 'failed' AND error_code IS NOT NULL GROUP BY 1, 2) f
      GROUP BY fonte_id
    ),
    avisos AS (
      SELECT fonte_id, jsonb_object_agg(tipo, n) AS mapa
      FROM (
        SELECT r.fonte_id, a.valor->>'tipo' AS tipo, count(*) AS n
        FROM recentes r
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(r.qualidade_resumo->'avisos') = 'array' THEN r.qualidade_resumo->'avisos' ELSE '[]'::jsonb END
        ) AS a(valor)
        WHERE a.valor->>'tipo' IS NOT NULL
        GROUP BY 1, 2
      ) x
      GROUP BY fonte_id
    ),
    faltantes AS (
      SELECT fonte_id, jsonb_object_agg(causa, n) AS mapa
      FROM (
        SELECT r.fonte_id, f.valor->>'causa' AS causa, count(*) AS n
        FROM recentes r
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(r.qualidade_resumo->'faltantes') = 'array' THEN r.qualidade_resumo->'faltantes' ELSE '[]'::jsonb END
        ) AS f(valor)
        WHERE f.valor->>'causa' IS NOT NULL
        GROUP BY 1, 2
      ) x
      GROUP BY fonte_id
    )
    SELECT b.fonte_id,
           coalesce(array_agg(DISTINCT b.window_start::text || '|' || b.window_end::text)
             FILTER (WHERE b.status = 'success' AND b.modo IN ('incremental', 'completa')), '{}') AS janelas_ok,
           max(b.finished_at) FILTER (WHERE b.status IN ('success', 'partial') AND b.modo IN ('incremental', 'completa')) AS ultima_ok_em,
           max(b.started_at) AS ultima_tentativa_em,
           (array_agg(b.status ORDER BY b.started_at DESC))[1] AS ultimo_status,
           count(*) FILTER (WHERE b.status = 'partial' AND b.started_at >= now() - interval '14 days')::integer AS parciais_recentes,
           max(b.pausa_ate) FILTER (WHERE b.pausa_ate > now()) AS pausada_ate,
           coalesce(max(fa.mapa::text), '{}')::jsonb AS falhas,
           coalesce(max(av.mapa::text), '{}')::jsonb AS avisos,
           coalesce(max(ft.mapa::text), '{}')::jsonb AS faltantes
    FROM base b
    LEFT JOIN falhas fa ON fa.fonte_id = b.fonte_id
    LEFT JOIN avisos av ON av.fonte_id = b.fonte_id
    LEFT JOIN faltantes ft ON ft.fonte_id = b.fonte_id
    GROUP BY b.fonte_id
    ORDER BY b.fonte_id`;
  const cobertura = await tx`
    SELECT tabela, desde::text AS desde, ate::text AS ate, linhas, dias_com_dado, medido_em
    FROM core.client_brain_coverage WHERE client_id = ${id} ORDER BY tabela`;
  const desempenho = await tx`
    SELECT platform, periodo::text AS periodo, recorte, chave, rotulo, investimento_centavos, impressoes, cliques, conversoes,
           receita_centavos, moeda, medido_em
    FROM core.client_brain_performance WHERE client_id = ${id} ORDER BY platform, periodo, recorte, chave`;
  return { clientes, conexoes, fontes, coletas, cobertura, desempenho } as unknown as LinhasDoInventario;
}

export const CONSULTAS_DO_INVENTARIO = 6;
