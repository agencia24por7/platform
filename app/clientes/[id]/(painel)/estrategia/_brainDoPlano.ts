import { montarSnapshotDoCliente } from '@/../app/clientes/[id]/_brain/fonte';
import type { ComandoDeEstrategia, OpcoesDoPainel } from '@/modules/strategy/application/estrategiaService';
import type { EntradaDoBrainConhecida } from '@/modules/strategy/interface/visaoDoPlano';

export type BrainDaPagina = { readonly entradas: ReadonlyMap<string, EntradaDoBrainConhecida>; readonly snapshot: OpcoesDoPainel['snapshotDoBrain'] };

export async function brainDaPagina(comando: ComandoDeEstrategia, clientId: string): Promise<BrainDaPagina> {
  try {
    const montado = await montarSnapshotDoCliente(comando.organizationId, clientId, comando.papelDeQuemAge);
    if (!montado.ok) return { entradas: new Map(), snapshot: 'indisponivel' };
    return {
      entradas: new Map(montado.value.entradas.map((entrada) => [entrada.urn, {
        titulo: entrada.titulo,
        nota: entrada.evidencia?.nota ?? null,
        ...(entrada.evidencia ? { categoria: entrada.evidencia.categoria } : {}),
        ...(entrada.evidencia?.validoAte ? { validoAte: entrada.evidencia.validoAte } : {}),
        ...(entrada.evidencia?.verificadoEm ? { verificadoEm: entrada.evidencia.verificadoEm } : {}),
      }])),
      snapshot: montado.value,
    };
  } catch {
    return { entradas: new Map(), snapshot: 'indisponivel' };
  }
}
