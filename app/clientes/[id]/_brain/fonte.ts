import type { BrainDoCliente } from '@/modules/clients/domain/painel/brain/tipos';
import { adaptadorDeExemplo } from '@/../app/clientes/[id]/_brain/exemplo';

export type EscopoDoBrain = {
  readonly organizationId: string;
  readonly clientId: string;
  readonly clienteNome: string;
};

export type AdaptadorDoBrain = (escopo: EscopoDoBrain) => Promise<BrainDoCliente>;

const ADAPTADOR: AdaptadorDoBrain = adaptadorDeExemplo;

export function buscarBrainDoCliente(escopo: EscopoDoBrain): Promise<BrainDoCliente> {
  return ADAPTADOR(escopo);
}
