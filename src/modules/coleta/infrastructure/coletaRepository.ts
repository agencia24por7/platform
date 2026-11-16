import { sql } from '@/shared/db/client';
import { withTenant } from '@/shared/db/tenant';
import type { Platform } from '@/modules/connections/domain/connection';
import type { AbrirColetaInput, Coleta, FecharColetaInput, FonteElegivel, FonteTipo } from '@/modules/coleta/domain/coleta';
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

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

const toFonte = (row: FonteRow): Omit<FonteElegivel, 'janelaSugerida'> => ({
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
};

export type ColetaRepository = {
  fontes(limit: number): Promise<readonly Omit<FonteElegivel, 'janelaSugerida'>[]>;
  resolveFonte(fonteTipo: FonteTipo, fonteId: string): Promise<{ organizationId: string; clientId: string; platform: Platform } | null>;
  resolveContextoDeGravacao(coletaId: string): Promise<ContextoDeGravacao | null>;
  findByIdempotencyKey(key: string): Promise<Coleta | null>;
  abrir(input: AbrirColetaInput, organizationId: string, clientId: string, platform: Platform): Promise<Coleta>;
  fechar(input: FecharColetaInput): Promise<Coleta | null>;
  marcarFalhaDeAuth(fonteTipo: FonteTipo, fonteId: string): Promise<void>;
};

export function createColetaRepository(): ColetaRepository {
  return {
    async fontes(limit) {
      const rows = (await sql()`
        SELECT * FROM automation.fontes_de_coleta(${limit})`) as unknown as FonteRow[];
      return rows.map(toFonte);
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
        SELECT organization_id, client_id, platform, external_id, currency FROM automation.resolve_coleta_contexto(${coletaId})`) as unknown as {
        organization_id: string;
        client_id: string;
        platform: Platform;
        external_id: string;
        currency: string;
      }[];
      const found = rows[0];
      return found
        ? { organizationId: found.organization_id, clientId: found.client_id, platform: found.platform, externalId: found.external_id, currency: found.currency }
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

    async marcarFalhaDeAuth(fonteTipo, fonteId) {
      await sql()`SELECT automation.coleta_falhou_por_auth(${fonteTipo}, ${fonteId})`;
    },
  };
}
