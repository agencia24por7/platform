import { sql } from '@/shared/db/client';
import { withTenant } from '@/shared/db/tenant';
import type { ModelosRepository } from '../application/modelosService.ts';
import { CONFIGURACAO_PADRAO, bloqueioDoDia, type ChaveGuardada, type ConfiguracaoDeIa, type EscolhaDeModelo, type UsoDoDia } from '../domain/modelos.ts';
import type { Fornecedor } from '../domain/tarefa.ts';

type ChaveRow = { provider: Fornecedor; key_label: string; models: string[]; models_listed_at: Date | null; updated_at: Date };
type SeladaRow = { key_ciphertext: Buffer; kms_key_version: string };
type EscolhaRow = { task: string; provider: Fornecedor; model: string };
type ConfiguracaoRow = { enabled: boolean; daily_calls: number; daily_tokens: string | number };
type UsoRow = { chamadas: number; tokens: string | number };

function configuracaoDe(row: ConfiguracaoRow | undefined): ConfiguracaoDeIa {
  if (!row) return CONFIGURACAO_PADRAO;
  return { ligada: row.enabled, chamadasPorDia: row.daily_calls, tokensPorDia: Number(row.daily_tokens) };
}

function usoDe(row: UsoRow | undefined): UsoDoDia {
  return { chamadas: row?.chamadas ?? 0, tokens: Number(row?.tokens ?? 0) };
}

export function createModelosRepository(): ModelosRepository {
  return {
    async chaves(organizationId) {
      const rows = (await withTenant(organizationId, (tx) => tx`
        SELECT provider, key_label, models, models_listed_at, updated_at
          FROM core.ai_provider_keys WHERE organization_id = ${organizationId} ORDER BY provider`)) as unknown as ChaveRow[];
      return rows.map(
        (row): ChaveGuardada => ({
          fornecedor: row.provider,
          rotulo: row.key_label,
          modelos: row.models,
          modelosListadosEm: row.models_listed_at,
          atualizadaEm: row.updated_at,
        }),
      );
    },

    async selada(organizationId, fornecedor) {
      const rows = (await withTenant(organizationId, (tx) => tx`
        SELECT key_ciphertext, kms_key_version FROM core.ai_provider_keys
         WHERE organization_id = ${organizationId} AND provider = ${fornecedor}`)) as unknown as SeladaRow[];
      const row = rows[0];
      return row ? { bytes: Buffer.from(row.key_ciphertext), versaoDaChave: row.kms_key_version } : null;
    },

    async guardarChave(nova) {
      await withTenant(nova.organizationId, (tx) => tx`
        INSERT INTO core.ai_provider_keys
          (organization_id, provider, key_ciphertext, kms_key_version, key_algorithm, key_label, models, models_listed_at, created_by)
        VALUES (${nova.organizationId}, ${nova.fornecedor}, ${nova.selado.bytes}, ${nova.selado.versaoDaChave}, ${nova.selado.algoritmo},
                ${nova.rotulo}, ${[...nova.modelos]}::text[], now(), ${nova.userId})
        ON CONFLICT (organization_id, provider) DO UPDATE SET
          key_ciphertext = EXCLUDED.key_ciphertext, kms_key_version = EXCLUDED.kms_key_version, key_algorithm = EXCLUDED.key_algorithm,
          key_label = EXCLUDED.key_label, models = EXCLUDED.models, models_listed_at = now()`);
    },

    async atualizarModelos(organizationId, fornecedor, modelos) {
      await withTenant(organizationId, (tx) => tx`
        UPDATE core.ai_provider_keys SET models = ${[...modelos]}::text[], models_listed_at = now()
         WHERE organization_id = ${organizationId} AND provider = ${fornecedor}`);
    },

    async removerChave(organizationId, fornecedor) {
      const rows = (await withTenant(organizationId, (tx) => tx`
        DELETE FROM core.ai_provider_keys WHERE organization_id = ${organizationId} AND provider = ${fornecedor} RETURNING provider`)) as unknown as unknown[];
      return rows.length === 1;
    },

    async regravarChave(organizationId, fornecedor, selado, lida) {
      const rows = (await withTenant(organizationId, (tx) => tx`
        UPDATE core.ai_provider_keys
           SET key_ciphertext = ${selado.bytes}, kms_key_version = ${selado.versaoDaChave}, key_algorithm = ${selado.algoritmo}
         WHERE organization_id = ${organizationId} AND provider = ${fornecedor}
           AND kms_key_version = ${lida.versaoDaChave} AND key_ciphertext = ${lida.bytes}
        RETURNING provider`)) as unknown as unknown[];
      return rows.length === 1;
    },

    async comVersaoAntiga(versaoPrimaria, limite) {
      const rows = (await sql()`
        SELECT organization_id, provider FROM core.ia_chaves_com_versao_antiga(${versaoPrimaria}, ${limite})`) as unknown as {
        organization_id: string;
        provider: Fornecedor;
      }[];
      return rows.map((row) => ({ organizationId: row.organization_id, fornecedor: row.provider }));
    },

    async escolhas(organizationId) {
      const rows = (await withTenant(organizationId, (tx) => tx`
        SELECT task, provider, model FROM core.ai_task_models WHERE organization_id = ${organizationId}`)) as unknown as EscolhaRow[];
      return rows.map((row): EscolhaDeModelo => ({ tarefa: row.task, fornecedor: row.provider, modelo: row.model }));
    },

    async escolher(organizationId, escolha, userId) {
      await withTenant(organizationId, (tx) => tx`
        INSERT INTO core.ai_task_models (organization_id, task, provider, model, updated_by)
        VALUES (${organizationId}, ${escolha.tarefa}, ${escolha.fornecedor}, ${escolha.modelo}, ${userId})
        ON CONFLICT (organization_id, task) DO UPDATE SET
          provider = EXCLUDED.provider, model = EXCLUDED.model, updated_by = EXCLUDED.updated_by, updated_at = now()`);
    },

    async removerEscolha(organizationId, tarefa) {
      const rows = (await withTenant(organizationId, (tx) => tx`
        DELETE FROM core.ai_task_models WHERE organization_id = ${organizationId} AND task = ${tarefa} RETURNING task`)) as unknown as unknown[];
      return rows.length === 1;
    },

    async configuracao(organizationId) {
      const rows = (await withTenant(organizationId, (tx) => tx`
        SELECT enabled, daily_calls, daily_tokens FROM core.ai_settings WHERE organization_id = ${organizationId}`)) as unknown as ConfiguracaoRow[];
      return configuracaoDe(rows[0]);
    },

    async salvarLigada(organizationId, ligada, userId) {
      await withTenant(organizationId, (tx) => tx`
        INSERT INTO core.ai_settings (organization_id, enabled, updated_by)
        VALUES (${organizationId}, ${ligada}, ${userId})
        ON CONFLICT (organization_id) DO UPDATE SET
          enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`);
    },

    async salvarTetos(organizationId, tetos, userId) {
      await withTenant(organizationId, (tx) => tx`
        INSERT INTO core.ai_settings (organization_id, daily_calls, daily_tokens, updated_by)
        VALUES (${organizationId}, ${tetos.chamadasPorDia}, ${tetos.tokensPorDia}, ${userId})
        ON CONFLICT (organization_id) DO UPDATE SET
          daily_calls = EXCLUDED.daily_calls, daily_tokens = EXCLUDED.daily_tokens,
          updated_by = EXCLUDED.updated_by, updated_at = now()`);
    },

    async usoDeHoje(organizationId) {
      const rows = (await withTenant(organizationId, (tx) => tx`
        SELECT count(*)::int AS chamadas,
               coalesce(sum(CASE WHEN result = 'ok' THEN input_tokens + output_tokens
                                   ELSE greatest(reserved_tokens, input_tokens + output_tokens) END), 0) AS tokens
          FROM core.ai_usage
         WHERE organization_id = ${organizationId} AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`)) as unknown as UsoRow[];
      return usoDe(rows[0]);
    },

    async reservar(reserva) {
      return withTenant(reserva.organizationId, async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`ai_usage:${reserva.organizationId}`}))`;
        const configuracoes = (await tx`
          SELECT enabled, daily_calls, daily_tokens FROM core.ai_settings WHERE organization_id = ${reserva.organizationId}`) as unknown as ConfiguracaoRow[];
        const usos = (await tx`
          SELECT count(*)::int AS chamadas,
                 coalesce(sum(CASE WHEN result = 'ok' THEN input_tokens + output_tokens
                                   ELSE greatest(reserved_tokens, input_tokens + output_tokens) END), 0) AS tokens
            FROM core.ai_usage
           WHERE organization_id = ${reserva.organizationId} AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`) as unknown as UsoRow[];
        const bloqueio = bloqueioDoDia(configuracaoDe(configuracoes[0]), usoDe(usos[0]), reserva.tokensReservados);
        if (bloqueio) return { bloqueio };
        const criadas = (await tx`
          INSERT INTO core.ai_usage (organization_id, task, provider, model, reserved_tokens, request_id)
          VALUES (${reserva.organizationId}, ${reserva.tarefa}, ${reserva.fornecedor}, ${reserva.modelo}, ${reserva.tokensReservados}, ${reserva.requestId})
          RETURNING id::text AS id`) as unknown as { id: string }[];
        return { id: criadas[0]!.id };
      });
    },

    async concluir(organizationId, reservaId, desfecho) {
      await withTenant(organizationId, (tx) => tx`
        UPDATE core.ai_usage
           SET result = ${desfecho.resultado}, input_tokens = ${desfecho.uso.tokensDeEntrada}, output_tokens = ${desfecho.uso.tokensDeSaida},
               cached_input_tokens = least(${desfecho.uso.tokensDeEntradaEmCache}::int, ${desfecho.uso.tokensDeEntrada}::int),
               steps = ${desfecho.uso.passos}, duration_ms = ${Math.max(0, Math.trunc(desfecho.duracaoMs))}
         WHERE id = ${reservaId}::bigint AND organization_id = ${organizationId} AND result = 'reservada'`);
    },
  };
}
