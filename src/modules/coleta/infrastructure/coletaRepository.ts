import { sql } from '@/shared/db/client';
import { withTenant } from '@/shared/db/tenant';
import type { Platform } from '@/modules/connections/domain/connection';
import { FONTE_OCUPADA, chaveDaFonte, type AbrirColetaInput, type Coleta, type FecharColetaInput, type FonteBruta, type FonteTipo } from '@/modules/coleta/domain/coleta';
import type { EscopoDaPausa, HistoricoDeColeta, MotivoDaPausa } from '@/modules/coleta/domain/janelaIncremental';
import type { RelatorioDeExecucao } from '@/modules/coleta/domain/qualidade';

type FonteRow = {
  fonte_tipo: FonteTipo;
  fonte_id: string;
  organization_id: string;
  client_id: string;
  client_name: string;
  platform: Platform;
  external_id: string;
  manager_external_id: string | null;
  nome: string;
  currency: string;
  timezone: string;
  credential_ref: string;
  coletor_ref: string | null;
  connection_id: string;
};

type HistoricoRow = {
  fonte_tipo: FonteTipo;
  fonte_id: string;
  ultima_janela_sucesso: Date | null;
  ultima_janela_parcial_repetida: Date | null;
  ultima_incremental_em: Date | null;
  pausa_ate: Date | null;
  pausa_da_plataforma_ate: Date | null;
  em_execucao_desde: Date | null;
  ultima_tentativa_em: Date | null;
  falhas_consecutivas: number | null;
};

type ColetaRow = {
  id: string;
  organization_id: string;
  client_id: string;
  platform: Platform;
  fonte_tipo: FonteTipo;
  ad_account_id: string | null;
  connection_account_id: string | null;
  mode: Coleta['mode'];
  idempotency_key: string;
  status: Coleta['status'];
  window_start: Date;
  window_end: Date;
  request_count: number;
  rows_received: number;
  rows_written: number;
  qualidade_resumo: RelatorioDeExecucao | null;
  started_at: Date;
  finished_at: Date | null;
  duration_ms: number | null;
  n8n_execution_id: string | null;
  error_code: string | null;
  error_message: string | null;
};

const TETO_DE_FONTES = 2000;
const INDICE_DE_UMA_RUNNING_POR_FONTE = 'coletas_uma_running_por_fonte';


function violouUmaRunningPorFonte(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) return false;
  const { code, constraint_name: restricao } = erro as { code?: unknown; constraint_name?: unknown };
  return code === '23505' && restricao === INDICE_DE_UMA_RUNNING_POR_FONTE;
}

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
const isoDateOuNulo = (value: Date | null): string | null => (value ? isoDate(value) : null);

const toFonte = (row: FonteRow): FonteBruta => ({
  fonteTipo: row.fonte_tipo,
  fonteId: row.fonte_id,
  organizationId: row.organization_id,
  clientId: row.client_id,
  clientName: row.client_name,
  platform: row.platform,
  externalId: row.external_id,
  managerExternalId: row.manager_external_id,
  nome: row.nome,
  currency: row.currency,
  timezone: row.timezone,
  credentialRef: row.credential_ref,
  coletorRef: row.coletor_ref,
  connectionId: row.connection_id,
});

const toColeta = (row: ColetaRow): Coleta => ({
  id: row.id,
  organizationId: row.organization_id,
  clientId: row.client_id,
  platform: row.platform,
  fonteTipo: row.fonte_tipo,
  adAccountId: row.ad_account_id,
  connectionAccountId: row.connection_account_id,
  mode: row.mode,
  idempotencyKey: row.idempotency_key,
  status: row.status,
  window: { start: isoDate(row.window_start), end: isoDate(row.window_end) },
  requestCount: row.request_count,
  rowsReceived: row.rows_received,
  rowsWritten: row.rows_written,
  qualidadeResumo: typeof row.qualidade_resumo === 'string' ? JSON.parse(row.qualidade_resumo) : row.qualidade_resumo,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  durationMs: row.duration_ms,
  n8nExecutionId: row.n8n_execution_id,
  errorCode: row.error_code,
  errorMessage: row.error_message,
});

export type ContextoDeGravacao = {
  readonly organizationId: string;
  readonly clientId: string;
  readonly platform: Platform;
  readonly externalId: string;
  readonly currency: string;
  readonly coletaStatus: string;
  readonly clienteExcluido: boolean;
};

export type ColetaRepository = {
  fontes(limit: number, plataformas: readonly Platform[]): Promise<readonly FonteBruta[]>;
  historicos(): Promise<ReadonlyMap<string, HistoricoDeColeta>>;
  resolveFonte(fonteTipo: FonteTipo, fonteId: string): Promise<{ organizationId: string; clientId: string; platform: Platform } | null>;
  resolveContextoDeGravacao(coletaId: string): Promise<ContextoDeGravacao | null>;
  findByIdempotencyKey(key: string): Promise<Coleta | null>;
  abrir(input: AbrirColetaInput, organizationId: string, clientId: string, platform: Platform): Promise<Coleta | typeof FONTE_OCUPADA>;
  expirarColetasRunning(idadeHoras: number): Promise<number>;
  registrarPausa(coletaId: string, ate: Date, motivo: MotivoDaPausa, escopo: EscopoDaPausa): Promise<void>;
  fechar(input: FecharColetaInput): Promise<Coleta | null>;
  marcarFalhaDeAuth(fonteTipo: FonteTipo, fonteId: string): Promise<void>;
  marcarColetaConcluida(fonteTipo: FonteTipo, fonteId: string, em: Date): Promise<void>;
};

function inserirColeta(input: AbrirColetaInput, organizationId: string, clientId: string, platform: Platform): Promise<Coleta> {
  return withTenant(organizationId, async (tx) => {
    const rows = (await tx`
      INSERT INTO automation.coletas
        (organization_id, client_id, platform, fonte_tipo, ad_account_id, connection_account_id,
         mode, idempotency_key, window_start, window_end, n8n_execution_id)
      VALUES (
        ${organizationId}, ${clientId}, ${platform}, ${input.fonteTipo},
        ${input.fonteTipo === 'ad_account' ? input.fonteId : null},
        ${input.fonteTipo === 'connection_account' ? input.fonteId : null},
        ${input.mode}, ${input.idempotencyKey}, ${input.window.start}, ${input.window.end}, ${input.n8nExecutionId}
      )
      RETURNING *`) as unknown as ColetaRow[];
    return toColeta(rows[0]!);
  });
}

export function createColetaRepository(): ColetaRepository {
  return {
    async fontes(limit, plataformas) {
      const rows = (await sql()`
        SELECT * FROM automation.fontes_de_coleta(${TETO_DE_FONTES})
        WHERE platform = ANY(${[...plataformas]}::text[])
        ORDER BY fonte_id
        LIMIT ${Math.max(Math.min(limit, TETO_DE_FONTES), 1)}`) as unknown as FonteRow[];
      return rows.map(toFonte);
    },

    async historicos() {
      const rows = (await sql()`SELECT * FROM automation.historico_de_coleta()`) as unknown as HistoricoRow[];
      return new Map(rows.map((row) => [chaveDaFonte(row.fonte_tipo, row.fonte_id), {
        ultimaJanelaSucesso: isoDateOuNulo(row.ultima_janela_sucesso),
        ultimaJanelaParcialRepetida: isoDateOuNulo(row.ultima_janela_parcial_repetida),
        ultimaIncrementalEm: row.ultima_incremental_em,
        pausaAte: row.pausa_ate,
        pausaDaPlataformaAte: row.pausa_da_plataforma_ate,
        emExecucaoDesde: row.em_execucao_desde,
        ultimaTentativaEm: row.ultima_tentativa_em,
        falhasConsecutivas: Number(row.falhas_consecutivas ?? 0),
      }]));
    },

    async expirarColetasRunning(idadeHoras) {
      const rows = (await sql()`SELECT automation.expirar_coletas_running(make_interval(hours => ${idadeHoras})) AS expiradas`) as unknown as { expiradas: number }[];
      return Number(rows[0]?.expiradas ?? 0);
    },

    async registrarPausa(coletaId, ate, motivo, escopo) {
      await sql()`SELECT automation.registrar_pausa_da_coleta(${coletaId}, ${ate}, ${motivo}, ${escopo})`;
    },

    async resolveFonte(fonteTipo, fonteId) {
      const rows = (await sql()`
        SELECT organization_id, client_id, platform FROM automation.resolve_coleta_fonte(${fonteTipo}, ${fonteId})`) as unknown as {
        organization_id: string;
        client_id: string;
        platform: Platform;
      }[];
      const found = rows[0];
      return found ? { organizationId: found.organization_id, clientId: found.client_id, platform: found.platform } : null;
    },

    async resolveContextoDeGravacao(coletaId) {
      const rows = (await sql()`
        SELECT organization_id, client_id, platform, external_id, currency, coleta_status, cliente_excluido
        FROM automation.resolve_coleta_contexto(${coletaId})`) as unknown as {
        organization_id: string;
        client_id: string;
        platform: Platform;
        external_id: string;
        currency: string;
        coleta_status: string;
        cliente_excluido: boolean;
      }[];
      const found = rows[0];
      return found
        ? {
            organizationId: found.organization_id,
            clientId: found.client_id,
            platform: found.platform,
            externalId: found.external_id,
            currency: found.currency,
            coletaStatus: found.coleta_status,
            clienteExcluido: found.cliente_excluido,
          }
        : null;
    },

    async findByIdempotencyKey(key) {
      const rows = (await sql()`
        SELECT organization_id, coleta_id FROM automation.resolve_coleta_by_key(${key})`) as unknown as {
        organization_id: string;
        coleta_id: string;
      }[];
      const found = rows[0];
      if (!found) return null;

      return withTenant(found.organization_id, async (tx) => {
        const coletaRows = (await tx`SELECT * FROM automation.coletas WHERE id = ${found.coleta_id}`) as unknown as ColetaRow[];
        return coletaRows[0] ? toColeta(coletaRows[0]) : null;
      });
    },

    async abrir(input, organizationId, clientId, platform) {
      try {
        return await inserirColeta(input, organizationId, clientId, platform);
      } catch (erro) {
        if (violouUmaRunningPorFonte(erro)) return FONTE_OCUPADA;
        throw erro;
      }
    },

    async fechar(input) {
      const rows = (await sql()`
        SELECT * FROM automation.fechar_coleta(
          ${input.coletaId}, ${input.status}::automation.run_status, ${input.requestCount},
          ${input.rowsReceived}, ${input.rowsWritten}, ${input.qualidadeResumo ? JSON.stringify(input.qualidadeResumo) : null}::jsonb,
          ${input.errorCode}, ${input.errorMessage}
        )`) as unknown as ColetaRow[];
      return rows[0]?.id ? toColeta(rows[0]) : null;
    },

    async marcarColetaConcluida(fonteTipo, fonteId, em) {
      await sql()`SELECT automation.coleta_concluida(${fonteTipo}, ${fonteId}, ${em})`;
    },

    async marcarFalhaDeAuth(fonteTipo, fonteId) {
      await sql()`SELECT automation.coleta_falhou_por_auth(${fonteTipo}, ${fonteId})`;
    },
  };
}
