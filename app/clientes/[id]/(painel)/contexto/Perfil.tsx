import { CabecalhoDeSecao } from '@/../app/clientes/[id]/_componentes/CabecalhoDeSecao';
import { carregarContexto, carregarPainel } from '@/../app/clientes/[id]/_dados';
import { EditorDeContexto } from '@/../app/clientes/[id]/(painel)/contexto/EditorDeContexto';
import { tamanhoLegivel } from '@/modules/clients/domain/painel/formato';

export async function Perfil({ clienteId, secaoInicial, campoInicial }: { readonly clienteId: string; readonly secaoInicial: string | null; readonly campoInicial: string | null }) {
  const { ctx, cliente, podeEditar } = await carregarPainel(clienteId);
  const contexto = await carregarContexto(ctx.organization.id, cliente.id);

  if (!contexto) {
    return <div className="alert alert--error">Não foi possível carregar o contexto agora.</div>;
  }

  const { catalogo: _catalogo, ...dados } = contexto;

  return (
    <div className="pilha">
      <CabecalhoDeSecao
        titulo="Mapa de contexto"
        descricao={`O que a equipe sabe sobre o negócio. Arquivos: ${tamanhoLegivel(contexto.usoDeArquivosBytes)} de ${tamanhoLegivel(contexto.cotaDeArquivosBytes)}.`}
      />
      <EditorDeContexto tipo={ctx.organization.type} clienteId={cliente.id} dados={dados} podeEditar={podeEditar} secaoInicial={secaoInicial} campoInicial={campoInicial} />
    </div>
  );
}
