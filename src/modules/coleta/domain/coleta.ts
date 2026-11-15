import type { Platform } from '@/modules/connections/domain/connection';
import type { ModoColeta } from '@/modules/coleta/domain/mapaDeFontes';
import type { RelatorioDeExecucao } from '@/modules/coleta/domain/qualidade';

export const FonteTipo = {
  AdAccount: 'ad_account',
  ConnectionAccount: 'connection_account',
} as const;
export type FonteTipo = (typeof FonteTipo)[keyof typeof FonteTipo];

export type Janela = { readonly start: string; readonly end: string };

export type FonteElegivel = {
  readonly fonteTipo: FonteTipo;
  readonly fonteId: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly platform: Platform;
  readonly externalId: string;
  readonly managerExternalId: string | null;
  readonly nome: string;
  readonly currency: string;
  readonly timezone: string;
  readonly credentialRef: string;
  readonly coletorRef: string | null;
  readonly connectionId: string;
};

export type ColetaStatus = 'running' | 'success' | 'partial' | 'failed';

export type Coleta = {
  readonly id: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly platform: Platform;
  readonly fonteTipo: FonteTipo;
  readonly adAccountId: string | null;
  readonly connectionAccountId: string | null;
  readonly mode: ModoColeta;
  readonly idempotencyKey: string;
  readonly status: ColetaStatus;
  readonly window: Janela;
  readonly requestCount: number;
  readonly rowsReceived: number;
  readonly rowsWritten: number;
  readonly qualidadeResumo: RelatorioDeExecucao | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly durationMs: number | null;
  readonly n8nExecutionId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
};

export type AbrirColetaInput = {
  readonly fonteTipo: FonteTipo;
  readonly fonteId: string;
  readonly mode: ModoColeta;
  readonly window: Janela;
  readonly idempotencyKey: string;
  readonly n8nExecutionId: string | null;
};

export type FecharColetaInput = {
  readonly coletaId: string;
  readonly status: Exclude<ColetaStatus, 'running'>;
  readonly requestCount: number;
  readonly rowsReceived: number;
  readonly rowsWritten: number;
  readonly qualidadeResumo: RelatorioDeExecucao | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
};

export function isJanelaSana(window: Janela, maxDays: number): boolean {
  const start = Date.parse(`${window.start}T00:00:00Z`);
  const end = Date.parse(`${window.end}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return false;
  return (end - start) / 86_400_000 <= maxDays;
}
