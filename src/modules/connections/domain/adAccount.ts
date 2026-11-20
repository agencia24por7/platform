import type { Platform } from '@/modules/connections/domain/connection';
import { canOperate, type MemberRole } from '../../identity/domain/user.ts';

export type AdAccountStatus = 'linked' | 'pending' | 'error' | 'unlinked';

export type AdAccount = {
  readonly id: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly connectionId: string;
  readonly platform: Platform;
  readonly externalId: string;
  readonly name: string;
  readonly accountGroup: string;
  readonly currency: string;
  readonly timezone: string;
  readonly status: AdAccountStatus;
  readonly syncEnabled: boolean;
  readonly lastSyncAt: Date | null;
};

export type NewAdAccount = Omit<AdAccount, 'id' | 'status' | 'lastSyncAt' | 'platform'>;

const GOOGLE_ID = /^\d{3}-\d{3}-\d{4}$/;
const META_ID = /^act_\d{6,20}$/;

export function normalizeExternalId(platform: Platform, raw: string): string {
  const trimmed = raw.trim();
  if (platform === 'meta') return trimmed.startsWith('act_') ? trimmed : `act_${trimmed.replace(/\D/g, '')}`;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : trimmed;
}

export function isValidExternalId(platform: Platform, value: string): boolean {
  return platform === 'google' ? GOOGLE_ID.test(value) : META_ID.test(value);
}

export type RecusaDeConta = {
  readonly codigo: 'forbidden' | 'not_found' | 'conflict';
  readonly mensagem: string;
};

export function recusaParaDesvincularConta(papel: MemberRole, conta: Pick<AdAccount, 'status'> | null): RecusaDeConta | null {
  if (!canOperate(papel)) return { codigo: 'forbidden', mensagem: 'Seu papel não permite desvincular contas.' };
  if (!conta) return { codigo: 'not_found', mensagem: 'Conta não encontrada nesta organização.' };
  if (conta.status === 'unlinked') return { codigo: 'conflict', mensagem: 'Esta conta já está desvinculada.' };
  return null;
}
