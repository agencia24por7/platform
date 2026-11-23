import { comoWorker } from '@/shared/db/client';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { limparAlerta, limparTexto, type AlertaRecebido } from '@/modules/alertas/domain/alerta';
import type { AlertaRepository } from '@/modules/alertas/infrastructure/alertaRepository';
import type { Failure } from '@/shared/result/failure';
import { ok, type Result } from '@/shared/result/result';

type WorkerIdentity = { readonly requestId: string; readonly callerFingerprint: string; readonly sourceIp: string | null };

export type ResumoDoAlerta = { readonly id: string | null; readonly deduplicado: boolean; readonly limitado: boolean };

export type Notificador = (texto: string) => Promise<void>;
export type LimiteDeNovos = () => boolean;
export type ConfirmaOperador = (userId: string) => Promise<boolean>;

export type AlertaService = {
  registrar(recebido: AlertaRecebido, worker: WorkerIdentity): Promise<Result<ResumoDoAlerta, Failure>>;
  contarAbertosParaOperador(userId: string): Promise<number>;
};

export function createAlertaService(
  alertas: AlertaRepository,
  audit: AuditRecorder,
  notificar: Notificador,
  podeCriarNovo: LimiteDeNovos,
  ehOperador: ConfirmaOperador,
): AlertaService {
  return {
    async registrar(recebido, worker) {
      const alerta = limparAlerta(recebido);
      if (!podeCriarNovo()) return ok({ id: null, deduplicado: false, limitado: true });

      const { id, deduplicado } = await alertas.registrar(alerta);
      if (deduplicado) return ok({ id, deduplicado: true, limitado: false });

      await audit.record({
        organizationId: null,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'plataforma.alerta',
        targetType: 'alerta',
        targetId: id,
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: { workflow: alerta.workflowNome, no: alerta.no, mensagem: alerta.mensagem },
      });
      await notificar(limparTexto(`Falha em ${alerta.workflowNome}${alerta.no ? ` (${alerta.no})` : ''}: ${alerta.mensagem}`, 700));
      return ok({ id, deduplicado: false, limitado: false });
    },

    async contarAbertosParaOperador(userId) {
      if (!(await ehOperador(userId))) return 0;
      return comoWorker(() => alertas.contarAbertos());
    },
  };
}
