import { err, ok, type Result } from '../../../shared/result/result.ts';

export const STATUS_DA_VERSAO = ['rascunho', 'proposto', 'vigente', 'superado', 'revogado', 'rejeitado', 'cancelado'] as const;
export type StatusDaVersao = (typeof STATUS_DA_VERSAO)[number];

export const ROTULO_DO_STATUS: Readonly<Record<StatusDaVersao, string>> = {
  rascunho: 'Em rascunho',
  proposto: 'Em autorização',
  vigente: 'Autorizado',
  superado: 'Substituído',
  revogado: 'Revogado',
  rejeitado: 'Rejeitado',
  cancelado: 'Cancelado',
};

export const TRANSICOES_DE_STATUS: Readonly<Record<StatusDaVersao, readonly StatusDaVersao[]>> = {
  rascunho: ['proposto', 'cancelado'],
  proposto: ['vigente', 'rejeitado', 'cancelado'],
  vigente: ['superado', 'revogado'],
  superado: [],
  revogado: [],
  rejeitado: [],
  cancelado: [],
};

export const STATUS_ABERTOS: readonly StatusDaVersao[] = ['rascunho', 'proposto'];

export function podeTransitar(de: StatusDaVersao, para: StatusDaVersao): boolean {
  return TRANSICOES_DE_STATUS[de].includes(para);
}

export function statusAberto(status: StatusDaVersao): boolean {
  return STATUS_ABERTOS.includes(status);
}

export function statusFinal(status: StatusDaVersao): boolean {
  return TRANSICOES_DE_STATUS[status].length === 0;
}

export const TIPOS_DE_EVENTO = [
  'proposta',
  'parecer',
  'ajuste',
  'gate',
  'veredito_juiz',
  'cancelada',
  'efetivada',
  'rejeitada',
  'revogada',
  'revisao_aberta',
  'impacto_anotado',
  'redigida',
] as const;
export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number];

export type EfeitoDoEvento = {
  readonly aceitaEm: readonly StatusDaVersao[];
  readonly leva: StatusDaVersao | null;
  readonly superaVigenteAnterior: boolean;
};

const QUALQUER_STATUS: readonly StatusDaVersao[] = STATUS_DA_VERSAO;

export const EFEITO_DOS_EVENTOS: Readonly<Record<TipoDeEvento, EfeitoDoEvento>> = {
  proposta: { aceitaEm: ['rascunho'], leva: 'proposto', superaVigenteAnterior: false },
  parecer: { aceitaEm: ['rascunho'], leva: null, superaVigenteAnterior: false },
  ajuste: { aceitaEm: ['rascunho'], leva: null, superaVigenteAnterior: false },
  gate: { aceitaEm: ['rascunho'], leva: null, superaVigenteAnterior: false },
  veredito_juiz: { aceitaEm: ['rascunho'], leva: null, superaVigenteAnterior: false },
  cancelada: { aceitaEm: ['rascunho', 'proposto'], leva: 'cancelado', superaVigenteAnterior: false },
  efetivada: { aceitaEm: ['proposto'], leva: 'vigente', superaVigenteAnterior: true },
  rejeitada: { aceitaEm: ['proposto'], leva: 'rejeitado', superaVigenteAnterior: false },
  revogada: { aceitaEm: ['vigente'], leva: 'revogado', superaVigenteAnterior: false },
  revisao_aberta: { aceitaEm: QUALQUER_STATUS, leva: null, superaVigenteAnterior: false },
  impacto_anotado: { aceitaEm: QUALQUER_STATUS, leva: null, superaVigenteAnterior: false },
  redigida: { aceitaEm: QUALQUER_STATUS, leva: null, superaVigenteAnterior: false },
};

export type ErroDeStatus = {
  readonly codigo: 'evento_invalido_para_o_status';
  readonly mensagem: string;
};

export function statusAposEvento(atual: StatusDaVersao, evento: TipoDeEvento): Result<StatusDaVersao, ErroDeStatus> {
  const efeito = EFEITO_DOS_EVENTOS[evento];
  if (!efeito.aceitaEm.includes(atual)) {
    return err({
      codigo: 'evento_invalido_para_o_status',
      mensagem: `Evento ${evento} não vale para versão ${atual}.`,
    });
  }
  return ok(efeito.leva ?? atual);
}
