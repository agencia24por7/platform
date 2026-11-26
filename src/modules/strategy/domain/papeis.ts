import type { MemberRole } from '../../identity/domain/user.ts';
import type { StatusDaVersao } from './status.ts';

export const ACOES_DO_PLANO = ['ler', 'criar', 'editar', 'aplicar', 'cancelar', 'autorizar', 'rejeitar', 'revogar'] as const;
export type AcaoDoPlano = (typeof ACOES_DO_PLANO)[number];

export type AtorDoPlano = { readonly tipo: 'pessoa'; readonly papel: MemberRole } | { readonly tipo: 'agente' };

const PAPEIS_QUE_ESCREVEM: readonly MemberRole[] = ['owner', 'admin', 'operator'];
const PAPEIS_QUE_DECIDEM: readonly MemberRole[] = ['owner', 'admin'];

export const PAPEIS_POR_ACAO: Readonly<Record<AcaoDoPlano, readonly MemberRole[]>> = {
  ler: ['owner', 'admin', 'operator', 'viewer'],
  criar: PAPEIS_QUE_ESCREVEM,
  editar: PAPEIS_QUE_ESCREVEM,
  aplicar: PAPEIS_QUE_ESCREVEM,
  cancelar: PAPEIS_QUE_ESCREVEM,
  autorizar: PAPEIS_QUE_DECIDEM,
  rejeitar: PAPEIS_QUE_DECIDEM,
  revogar: PAPEIS_QUE_DECIDEM,
};

export const ACOES_DO_AGENTE: readonly AcaoDoPlano[] = ['ler', 'criar', 'editar', 'cancelar'];

export const STATUS_QUE_O_AGENTE_CANCELA: readonly StatusDaVersao[] = ['rascunho'];

export function podeExecutar(acao: AcaoDoPlano, ator: AtorDoPlano, statusAtual?: StatusDaVersao): boolean {
  if (ator.tipo === 'agente') {
    if (acao === 'cancelar') return statusAtual !== undefined && STATUS_QUE_O_AGENTE_CANCELA.includes(statusAtual);
    return ACOES_DO_AGENTE.includes(acao);
  }
  return PAPEIS_POR_ACAO[acao].includes(ator.papel);
}
