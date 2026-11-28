import { AvisoEfemero } from '@/../app/clientes/[id]/_componentes/AvisoEfemero';
import { carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { HistoricoDoContexto } from '@/../app/clientes/[id]/(painel)/atividade/HistoricoDoContexto';
import { LinhaDoTempoDeRegras } from '@/../app/clientes/[id]/(painel)/atividade/LinhaDoTempoDeRegras';
import { PedidosAoCliente } from '@/../app/clientes/[id]/(painel)/atividade/PedidosAoCliente';

export const dynamic = 'force-dynamic';

type Busca = Record<string, string | string[] | undefined>;

export default async function Atividade({ params, searchParams }: { readonly params: Promise<{ id: string }>; readonly searchParams: Promise<Busca> }) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  const { cliente } = await carregarPainel(id);
  const filtrosDaLinha = { categoria: primeiro(busca['categoria']), origem: primeiro(busca['origem']), status: primeiro(busca['status']), cursor: primeiro(busca['cursor']) };

  return (
    <div className="pilha atividade">
      <AvisoEfemero erro={primeiro(busca['erro'])} feito={primeiro(busca['feito'])} />
      <PedidosAoCliente clienteId={cliente.id} />
      <HistoricoDoContexto clienteId={cliente.id} />
      <LinhaDoTempoDeRegras clienteId={cliente.id} busca={filtrosDaLinha} />
    </div>
  );
}
