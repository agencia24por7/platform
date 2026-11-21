import { redirect } from 'next/navigation';
import { carregarPainel } from '@/../app/clientes/[id]/_dados';
import { rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';

export const dynamic = 'force-dynamic';

export default async function ConviteNovoLegado({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { cliente } = await carregarPainel(id);
  redirect(rotaDoCliente(cliente.id, 'conexoes', { secao: 'pedir' }));
}
