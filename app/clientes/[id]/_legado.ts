import { redirect } from 'next/navigation';
import { carregarPainel } from '@/../app/clientes/[id]/_dados';
import { destinoDaRotaLegada, type SegmentoLegado } from '@/modules/clients/domain/painel/enderecos';

export type BuscaDaRota = Promise<Record<string, string | string[] | undefined>>;

export async function redirecionarRotaLegada(params: Promise<{ id: string }>, busca: BuscaDaRota, segmento: SegmentoLegado): Promise<never> {
  const [{ id }, consulta] = await Promise.all([params, busca]);
  const { cliente } = await carregarPainel(id);
  redirect(destinoDaRotaLegada(cliente.id, segmento, consulta));
}
