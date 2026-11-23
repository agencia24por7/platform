import { logger } from '../../../shared/logging/logger.ts';
import type { AuditRecorder } from './auditRecorder.ts';
import type { AuditEvent } from '../domain/auditEvent.ts';

type LogDeErro = { error(mensagem: string, contexto?: Record<string, unknown>): void };

function tipoDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.name : 'desconhecido';
}

export async function registrarSemFalhar(
  recorder: Pick<AuditRecorder, 'record'>,
  evento: AuditEvent,
  log: LogDeErro = logger,
): Promise<void> {
  try {
    await recorder.record(evento);
  } catch (erro) {
    try {
      log.error('auditoria.falhou', { action: evento.action, requestId: evento.requestId, erro: tipoDoErro(erro) });
    } catch {
      return;
    }
  }
}
