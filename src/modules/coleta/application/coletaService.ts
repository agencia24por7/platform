import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { AbrirColetaInput, Coleta, FecharColetaInput, FonteElegivel } from '@/modules/coleta/domain/coleta';
import { isJanelaSana } from '@/modules/coleta/domain/coleta';
import { fonteDe, janelaDias } from '@/modules/coleta/domain/mapaDeFontes';
import type { ColetaRepository } from '@/modules/coleta/infrastructure/coletaRepository';

const MAX_WINDOW_DAYS = 28;

export type WorkerIdentity = { readonly requestId: string; readonly callerFingerprint: string; readonly sourceIp: string | null };

export type ColetaService = {
  fontes(limit: number, worker: WorkerIdentity): Promise<readonly FonteElegivel[]>;
  abrir(input: AbrirColetaInput, worker: WorkerIdentity): Promise<Result<Coleta, Failure>>;
  fechar(input: FecharColetaInput, worker: WorkerIdentity): Promise<Result<Coleta, Failure>>;
};

export function createColetaService(coletas: ColetaRepository, audit: AuditRecorder): ColetaService {
  return {
    async fontes(limit, worker) {
      const entries = await coletas.fontes(limit);
      await audit.record({
        organizationId: null,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'coleta.fontes.lidas',
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: { returned: entries.length, limit },
      });
      return entries;
    },

    async abrir(input, worker) {
      if (!isJanelaSana(input.window, MAX_WINDOW_DAYS)) {
        return err(failure('validation', `Janela inválida ou maior que ${MAX_WINDOW_DAYS} dias.`));
      }

      const existing = await coletas.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        const existingFonteId = existing.fonteTipo === 'ad_account' ? existing.adAccountId : existing.connectionAccountId;
        if (existing.fonteTipo !== input.fonteTipo || existingFonteId !== input.fonteId) {
          return err(failure('conflict', 'Esta chave de idempotência já pertence a uma execução de outra fonte.'));
        }
        return ok(existing);
      }

      const resolved = await coletas.resolveFonte(input.fonteTipo, input.fonteId);
      if (!resolved) return err(failure('not_found', 'Fonte de coleta não encontrada ou inelegível.'));

      const fonte = fonteDe(resolved.platform);
      if (!fonte.ativaNoV1) {
        return err(failure('validation', `Plataforma ${resolved.platform} está fora do v1 da camada de coleta: ${fonte.motivoForaDoV1}`));
      }

      const limiteJanela = janelaDias(resolved.platform, input.mode) || MAX_WINDOW_DAYS;
      if (!isJanelaSana(input.window, limiteJanela)) {
        return err(failure('validation', `Janela maior que ${limiteJanela} dias para o modo ${input.mode} nesta plataforma.`));
      }

      const coleta = await coletas.abrir(input, resolved.organizationId, resolved.clientId, resolved.platform);

      await audit.record({
        organizationId: resolved.organizationId,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'coleta.execucao.abrir',
        targetType: 'coleta',
        targetId: coleta.id,
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: {
          fonteTipo: coleta.fonteTipo,
          platform: coleta.platform,
          mode: coleta.mode,
          window: coleta.window,
          idempotencyKey: input.idempotencyKey,
          n8nExecutionId: input.n8nExecutionId,
        },
      });

      return ok(coleta);
    },

    async fechar(input, worker) {
      const closed = await coletas.fechar(input);
      if (!closed) return err(failure('conflict', 'Execução já encerrada.'));

      if (input.errorCode === 'reauth_pending') {
        const fonteId = closed.fonteTipo === 'ad_account' ? closed.adAccountId : closed.connectionAccountId;
        if (fonteId) await coletas.marcarFalhaDeAuth(closed.fonteTipo, fonteId);
      }

      await audit.record({
        organizationId: closed.organizationId,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'coleta.execucao.fechar',
        targetType: 'coleta',
        targetId: closed.id,
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: {
          status: closed.status,
          durationMs: closed.durationMs,
          rowsReceived: closed.rowsReceived,
          rowsWritten: closed.rowsWritten,
          requestCount: closed.requestCount,
          errorCode: closed.errorCode,
          qualidade: closed.qualidadeResumo,
        },
      });

      return ok(closed);
    },
  };
}
