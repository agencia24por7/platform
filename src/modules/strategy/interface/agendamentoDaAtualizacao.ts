import type { Execucao } from '../application/portas.ts';

export const FAIXAS_DA_ATUALIZACAO_AUTOMATICA: readonly { readonly ateMs: number; readonly intervaloMs: number }[] = [
  { ateMs: 60_000, intervaloMs: 5_000 },
  { ateMs: 180_000, intervaloMs: 10_000 },
  { ateMs: 600_000, intervaloMs: 30_000 },
];

export const LIMITE_DA_ATUALIZACAO_AUTOMATICA_MS = 600_000;
export const LIMITE_DE_EXECUCAO_SEM_AVANCO_MS = 600_000;
export const TOLERANCIA_DO_LEASE_VENCIDO_MS = 120_000;

export function proximoIntervalo(decorridoMs: number): number | null {
  if (!Number.isFinite(decorridoMs) || decorridoMs < 0) return FAIXAS_DA_ATUALIZACAO_AUTOMATICA[0]?.intervaloMs ?? null;
  if (decorridoMs >= LIMITE_DA_ATUALIZACAO_AUTOMATICA_MS) return null;
  const faixa = FAIXAS_DA_ATUALIZACAO_AUTOMATICA.find((candidata) => decorridoMs < candidata.ateMs);
  return faixa ? faixa.intervaloMs : null;
}

export function execucaoSemAvanco(execucao: Pick<Execucao, 'status' | 'atualizadaEm' | 'leaseAte'>, agora: Date): boolean {
  if (execucao.status !== 'pendente' && execucao.status !== 'rodando') return false;
  if (agora.getTime() - execucao.atualizadaEm.getTime() > LIMITE_DE_EXECUCAO_SEM_AVANCO_MS) return true;
  return execucao.status === 'rodando' && execucao.leaseAte !== null && agora.getTime() - execucao.leaseAte.getTime() > TOLERANCIA_DO_LEASE_VENCIDO_MS;
}
