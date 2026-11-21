import { modules } from '@/composition';
import { brainDoCatalogo } from '@/modules/clients/domain/painel/brain/doCatalogo';
import type { BrainDoCliente } from '@/modules/clients/domain/painel/brain/tipos';

export type EscopoDoBrain = {
  readonly organizationId: string;
  readonly clientId: string;
};

export type BrainBuscado =
  | { readonly ok: true; readonly brain: BrainDoCliente }
  | { readonly ok: false; readonly motivo: 'nao_encontrado' | 'indisponivel' };

export async function buscarBrainDoCliente(escopo: EscopoDoBrain): Promise<BrainBuscado> {
  try {
    const montado = await modules().brain.montarNaOrganizacao(escopo.organizationId, escopo.clientId);
    return montado.ok ? { ok: true, brain: brainDoCatalogo(montado.value, new Date()) } : { ok: false, motivo: 'nao_encontrado' };
  } catch (erro) {
    console.error(JSON.stringify({ evento: 'brain.ui_indisponivel', clientId: escopo.clientId, erro: erro instanceof Error ? erro.message.slice(0, 300) : 'erro' }));
    return { ok: false, motivo: 'indisponivel' };
  }
}
