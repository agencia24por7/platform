import type { MemberRole } from '../../identity/domain/user.ts';
import { canAdminister, canOperate } from '../../identity/domain/user.ts';

export const SITUACOES = ['active', 'paused', 'archived'] as const;
export type Situacao = (typeof SITUACOES)[number];

export const ROTULO_DA_SITUACAO: Record<Situacao, string> = {
  active: 'Ativo',
  paused: 'Pausado',
  archived: 'Arquivado',
};

export const EFEITO_DA_SITUACAO: Record<Situacao, string> = {
  active: 'A coleta roda e o cliente aparece nas listas.',
  paused: 'A coleta para. O histórico fica e volta ao reativar.',
  archived: 'Sai da operação do dia a dia. O histórico continua auditável.',
};

export const MOTIVO_RECUSA_CICLO = {
  sem_permissao: 'Seu papel não permite mudar a situação deste cliente.',
  situacao_invalida: 'Situação desconhecida.',
  arquivar_exige_admin: 'Arquivar um cliente é decisão de quem administra.',
} as const;

export type MotivoRecusaCiclo = keyof typeof MOTIVO_RECUSA_CICLO;

export function ehSituacao(valor: string): valor is Situacao {
  return (SITUACOES as readonly string[]).includes(valor);
}

export function mudancaPermitida(papel: MemberRole, destino: string): MotivoRecusaCiclo | null {
  if (!ehSituacao(destino)) return 'situacao_invalida';
  if (!canOperate(papel)) return 'sem_permissao';
  if (destino === 'archived' && !canAdminister(papel)) return 'arquivar_exige_admin';
  return null;
}

export function coletaSegue(situacao: Situacao): boolean {
  return situacao === 'active';
}
