import { registrarSemFalhar } from '../../audit/application/registrarSemFalhar.ts';
import type { AuditRecorder } from '../../audit/application/auditRecorder.ts';
import { logger } from '../../../shared/logging/logger.ts';
import { criarJanelaLimitada } from '../../../shared/security/janelaLimitada.ts';

export type ResultadoDaPortaria = 'reuso' | 'aberta' | 'indisponivel';

export const LIMITE_DE_REUSO_POR_JANELA = 3;
const JANELA_DO_REUSO_MS = 60_000;
const MAX_USUARIOS_RASTREADOS = 5000;

const janelaDoReuso = criarJanelaLimitada({
  limite: LIMITE_DE_REUSO_POR_JANELA,
  janelaMs: JANELA_DO_REUSO_MS,
  maxChaves: MAX_USUARIOS_RASTREADOS,
  aoLotar: () => logger.warn('auditoria.dedup_lotado', { acao: 'n8n.portaria' }),
});

export type PassagemAuditada = {
  readonly resultado: ResultadoDaPortaria;
  readonly userId: string;
  readonly requestId: string;
  readonly sourceIp: string | null;
};

function reusoDentroDoLimite(userId: string): boolean {
  return janelaDoReuso.permitir(userId);
}

export async function auditarPortaria(recorder: Pick<AuditRecorder, 'record'>, passagem: PassagemAuditada): Promise<void> {
  if (passagem.resultado === 'reuso' && !reusoDentroDoLimite(passagem.userId)) return;
  await registrarSemFalhar(recorder, {
    organizationId: null,
    actorType: 'user',
    actorId: passagem.userId,
    action: 'n8n.portaria',
    requestId: passagem.requestId,
    sourceIp: passagem.sourceIp,
    metadata: { resultado: passagem.resultado },
  });
}
