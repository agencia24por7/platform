import { Barra } from '@/../app/clientes/[id]/_componentes/Anel';
import { carregarContexto, carregarPainel } from '@/../app/clientes/[id]/_dados';
import { EditorDeContexto } from '@/../app/clientes/[id]/(painel)/contexto/EditorDeContexto';
import { carregarDestino } from '@/../app/clientes/[id]/(painel)/contexto/destino/dados';
import { Destino } from '@/../app/clientes/[id]/(painel)/contexto/destino/Destino';
import { visaoDoPapel } from '@/modules/clients/domain/contexto/visaoDoCliente';
import { ANCORA_DO_MAPA } from '@/modules/clients/domain/painel/enderecos';
import { tamanhoLegivel } from '@/modules/clients/domain/painel/formato';

type Props = { readonly clienteId: string; readonly secaoInicial: string | null; readonly campoInicial: string | null };

export async function Perfil({ clienteId, secaoInicial, campoInicial }: Props) {
  const { ctx, cliente, podeEditar } = await carregarPainel(clienteId);
  const [contexto, destino] = await Promise.all([carregarContexto(ctx.organization.id, cliente.id, ctx.role), carregarDestino(cliente.id)]);

  if (!contexto) {
    return <div className="alert alert--error">Não foi possível carregar o contexto agora.</div>;
  }

  const { catalogo: _catalogo, ...dados } = contexto;

  return (
    <details className="card contexto-mapa" open={secaoInicial !== null || campoInicial !== null} id={ANCORA_DO_MAPA}>
      <summary className="contexto-mapa__resumo">
        <span className="contexto-mapa__titulos">
          <span className="contexto-mapa__titulo">Mapa de contexto</span>
          <span className="subtle xsmall">
            O que a equipe sabe sobre o negócio · arquivos {tamanhoLegivel(contexto.usoDeArquivosBytes)} de {tamanhoLegivel(contexto.cotaDeArquivosBytes)}
          </span>
        </span>
        <span className="contexto-mapa__total">
          <strong>{contexto.completude.geral}%</strong>
          <span className="subtle xsmall">preenchido</span>
        </span>
        <span className="contexto-mapa__barra">
          <Barra valor={contexto.completude.geral} rotulo="Mapa de contexto preenchido" />
        </span>
      </summary>
      <div className="contexto-mapa__corpo">
        <EditorDeContexto
          tipo={ctx.organization.type}
          clienteId={cliente.id}
          dados={dados}
          visao={visaoDoPapel(ctx.role)}
          podeEditar={podeEditar}
          secaoInicial={secaoInicial}
          campoInicial={campoInicial}
          destino={{ conteudo: <Destino clienteId={cliente.id} visao={destino} />, progresso: destino?.progresso ?? null }}
        />
      </div>
    </details>
  );
}
