import { carregarContexto, carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { EditorDeContexto } from '@/../app/clientes/[id]/(painel)/contexto/EditorDeContexto';

export const dynamic = 'force-dynamic';

export default async function ContextoDoCliente({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  const { ctx, cliente, podeEditar } = await carregarPainel(id);
  const contexto = await carregarContexto(ctx.organization.id, cliente.id);

  if (!contexto) {
    return <div className="alert alert--error">Não foi possível carregar o contexto deste cliente agora.</div>;
  }

  const { catalogo: _catalogo, ...dados } = contexto;

  return (
    <EditorDeContexto
      clienteId={cliente.id}
      dados={dados}
      podeEditar={podeEditar}
      secaoInicial={primeiro(busca['secao']) ?? null}
      campoInicial={primeiro(busca['campo']) ?? null}
    />
  );
}
