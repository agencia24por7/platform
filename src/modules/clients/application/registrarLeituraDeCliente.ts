import { registrarSemFalhar } from '../../audit/application/registrarSemFalhar.ts';
import type { AuditRecorder } from '../../audit/application/auditRecorder.ts';
import { logger } from '../../../shared/logging/logger.ts';
import { criarJanelaLimitada } from '../../../shared/security/janelaLimitada.ts';

export const JANELA_DA_LEITURA_MS = 60_000;

const MAX_LEITURAS_RASTREADAS = 5000;

const janelaDeLeitura = criarJanelaLimitada({
  limite: 1,
  janelaMs: JANELA_DA_LEITURA_MS,
  maxChaves: MAX_LEITURAS_RASTREADAS,
  aoLotar: () => logger.warn('auditoria.dedup_lotado', { acao: 'cliente.leitura' }),
});

export function deveRegistrarLeitura(userId: string, clientId: string): boolean {
  return janelaDeLeitura.permitir(`${userId}:${clientId}`);
}

export type LeituraDeCliente = {
  readonly organizationId: string;
  readonly userId: string;
  readonly clientId: string;
  readonly requestId: string;
};

export function registrarLeituraDeCliente(recorder: Pick<AuditRecorder, 'record'>, leitura: LeituraDeCliente): Promise<void> {
  return registrarSemFalhar(recorder, {
    organizationId: leitura.organizationId,
    actorType: 'user',
    actorId: leitura.userId,
    action: 'cliente.leitura',
    targetType: 'client',
    targetId: leitura.clientId,
    requestId: leitura.requestId,
  });
}
