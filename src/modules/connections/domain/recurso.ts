import { canOperate, type MemberRole } from '../../identity/domain/user.ts';
import { ROTULO_DO_RECURSO, concordaComRecurso, temRecursoParaVincular, type Platform } from './connection.ts';

export type EstadoDoRecurso = 'discovered' | 'linked' | 'ignored' | 'lost';

export type RecursoAvaliado = {
  readonly platform: Platform;
  readonly state: EstadoDoRecurso;
  readonly clientId: string | null;
};

export type ClienteAvaliado = {
  readonly id: string;
  readonly status: 'active' | 'paused' | 'archived';
};

export type Recusa = {
  readonly codigo: 'forbidden' | 'not_found' | 'validation' | 'conflict';
  readonly mensagem: string;
};

function nomeDoRecurso(recurso: RecursoAvaliado): string {
  return temRecursoParaVincular(recurso.platform) ? ROTULO_DO_RECURSO[recurso.platform] : 'Recurso';
}

function concordar(recurso: RecursoAvaliado, masculino: string, feminino: string): string {
  return temRecursoParaVincular(recurso.platform) ? concordaComRecurso(recurso.platform, masculino, feminino) : masculino;
}

function exigirRecurso(recurso: RecursoAvaliado | null): Recusa | null {
  if (!recurso) return { codigo: 'not_found', mensagem: 'Recurso não encontrado nesta organização.' };
  if (!temRecursoParaVincular(recurso.platform)) {
    return {
      codigo: 'validation',
      mensagem: 'Contas de anúncio do Google e da Meta são vinculadas como conta de anúncio, não como recurso.',
    };
  }
  return null;
}

function exigirClienteAtivo(cliente: ClienteAvaliado | null): Recusa | null {
  if (!cliente) return { codigo: 'validation', mensagem: 'Cliente não pertence a esta organização.' };
  if (cliente.status !== 'active') {
    return { codigo: 'validation', mensagem: 'Só um cliente ativo pode receber recursos. Reative o cliente antes.' };
  }
  return null;
}

export function recusaParaVincular(
  papel: MemberRole,
  recurso: RecursoAvaliado | null,
  cliente: ClienteAvaliado | null,
): Recusa | null {
  if (!canOperate(papel)) return { codigo: 'forbidden', mensagem: 'Seu papel não permite vincular recursos.' };
  const semRecurso = exigirRecurso(recurso);
  if (semRecurso) return semRecurso;
  if (recurso!.state === 'linked') {
    return {
      codigo: 'conflict',
      mensagem: `${nomeDoRecurso(recurso!)} já tem dono. Abra o cliente atual e use Mover para trocar o dono.`,
    };
  }
  if (recurso!.state !== 'discovered') {
    return { codigo: 'conflict', mensagem: `${nomeDoRecurso(recurso!)} não está mais disponível para vínculo.` };
  }
  return exigirClienteAtivo(cliente);
}

export function recusaParaMover(
  papel: MemberRole,
  recurso: RecursoAvaliado | null,
  destino: ClienteAvaliado | null,
): Recusa | null {
  if (!canOperate(papel)) return { codigo: 'forbidden', mensagem: 'Seu papel não permite mover recursos entre clientes.' };
  const semRecurso = exigirRecurso(recurso);
  if (semRecurso) return semRecurso;
  if (recurso!.state !== 'linked' || !recurso!.clientId) {
    return {
      codigo: 'conflict',
      mensagem: `${nomeDoRecurso(recurso!)} não está ${concordar(recurso!, 'vinculado', 'vinculada')} a nenhum cliente.`,
    };
  }
  return exigirClienteAtivo(destino);
}

export function recusaParaDesvincular(papel: MemberRole, recurso: RecursoAvaliado | null): Recusa | null {
  if (!canOperate(papel)) return { codigo: 'forbidden', mensagem: 'Seu papel não permite desvincular recursos.' };
  const semRecurso = exigirRecurso(recurso);
  if (semRecurso) return semRecurso;
  if (recurso!.state !== 'linked' || !recurso!.clientId) {
    return { codigo: 'conflict', mensagem: `${nomeDoRecurso(recurso!)} já está sem cliente.` };
  }
  return null;
}
