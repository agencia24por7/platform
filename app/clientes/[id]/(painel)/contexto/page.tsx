import { AvisoEfemero } from '@/../app/clientes/[id]/_componentes/AvisoEfemero';
import { carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { BrainView } from '@/../app/clientes/[id]/(painel)/contexto/brain/BrainView';
import { Cultura } from '@/../app/clientes/[id]/(painel)/contexto/cultura/Cultura';
import { Perfil } from '@/../app/clientes/[id]/(painel)/contexto/Perfil';
import { secaoInicialDoMapa } from '@/modules/clients/domain/painel/enderecos';

export const dynamic = 'force-dynamic';

export default async function Contexto({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  const { cliente } = await carregarPainel(id);

  return (
    <div className="pilha contexto">
      <AvisoEfemero erro={primeiro(busca['erro'])} feito={primeiro(busca['feito'])} />
      <BrainView
        clienteId={cliente.id}
        depoisDoTopo={<Perfil clienteId={cliente.id} secaoInicial={secaoInicialDoMapa(primeiro(busca['secao']))} campoInicial={primeiro(busca['campo']) ?? null} />}
      />
      <Cultura clienteId={cliente.id} />
    </div>
  );
}
