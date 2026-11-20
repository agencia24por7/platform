import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { RetencaoRepository, ResumoDaRetencao } from '@/modules/privacidade/infrastructure/retencaoRepository';
import type { Failure } from '@/shared/result/failure';
import { ok, type Result } from '@/shared/result/result';

type WorkerIdentity = { readonly requestId: string; readonly callerFingerprint: string; readonly sourceIp: string | null };

export type RetencaoService = {
  aplicar(worker: WorkerIdentity): Promise<Result<ResumoDaRetencao, Failure>>;
};

export function createRetencaoService(retencao: RetencaoRepository, audit: AuditRecorder): RetencaoService {
  return {
    async aplicar(worker) {
      const resumo = await retencao.aplicar();
      await audit.record({
        organizationId: null,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'privacidade.retencao_aplicada',
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: resumo,
      });
      return ok(resumo);
    },
  };
}
