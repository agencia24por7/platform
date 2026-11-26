import { cache } from 'react';
import { modules } from '@/composition';
import { brainDoCatalogo } from '@/modules/clients/domain/painel/brain/doCatalogo';
import type { BrainDoCliente } from '@/modules/clients/domain/painel/brain/tipos';
import type { MemberRole } from '@/modules/identity/domain/user';

export type EscopoDoBrain = {
  readonly organizationId: string;
  readonly clientId: string;
  readonly papelDeQuemLe: MemberRole;
};

export type BrainBuscado =
  | { readonly ok: true; readonly brain: BrainDoCliente }
  | { readonly ok: false; readonly motivo: 'nao_encontrado' | 'indisponivel' };

export const montarSnapshotDoCliente = cache(async (organizationId: string, clientId: string, papelDeQuemLe: MemberRole) =>
  modules().brain.montarNaOrganizacao(organizationId, clientId, papelDeQuemLe),
);

export async function buscarBrainDoCliente(escopo: EscopoDoBrain): Promise<BrainBuscado> {
  try {
    const montado = await montarSnapshotDoCliente(escopo.organizationId, escopo.clientId, escopo.papelDeQuemLe);
    return montado.ok ? { ok: true, brain: brainDoCatalogo(montado.value, new Date()) } : { ok: false, motivo: 'nao_encontrado' };
  } catch (erro) {
    console.error(JSON.stringify({ evento: 'brain.ui_indisponivel', clientId: escopo.clientId, erro: erro instanceof Error ? erro.message.slice(0, 300) : 'erro' }));
    return { ok: false, motivo: 'indisponivel' };
  }
}
