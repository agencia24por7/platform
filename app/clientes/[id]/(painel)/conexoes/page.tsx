import { AvisoEfemero } from '@/../app/clientes/[id]/_componentes/AvisoEfemero';
import { carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { Fontes } from '@/../app/clientes/[id]/(painel)/conexoes/Fontes';
import { OutrosJeitos } from '@/../app/clientes/[id]/(painel)/conexoes/OutrosJeitos';

export const dynamic = 'force-dynamic';

export default async function Conexoes({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  const { cliente } = await carregarPainel(id);

  return (
    <div className="pilha">
      <AvisoEfemero erro={primeiro(busca['erro'])} feito={primeiro(busca['feito'])} />
      <Fontes clienteId={cliente.id} abrirPedido={primeiro(busca['enviar']) === 'contexto'} />
      <OutrosJeitos clienteId={cliente.id} />
    </div>
  );
}
