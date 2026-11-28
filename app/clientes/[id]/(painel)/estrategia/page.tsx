import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AvisoEfemero } from '@/../app/clientes/[id]/_componentes/AvisoEfemero';
import { CabecalhoDeSecao } from '@/../app/clientes/[id]/_componentes/CabecalhoDeSecao';
import { EstadoVazio } from '@/../app/clientes/[id]/_componentes/EstadoVazio';
import { carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { AtualizacaoPeriodica } from '@/../app/clientes/[id]/(painel)/estrategia/AtualizacaoPeriodica';
import { CartaoDePlano } from '@/../app/clientes/[id]/(painel)/estrategia/CartaoDePlano';
import { FormularioDeNovoPlano } from '@/../app/clientes/[id]/(painel)/estrategia/FormularioDeNovoPlano';
import { modules } from '@/composition';
import { rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import { podeVerAEstrategia } from '@/modules/strategy/domain/papeis';
import { formularioDeNovoPlano } from '@/modules/strategy/interface/formularioDeNovoPlano';
import { visaoDaLista } from '@/modules/strategy/interface/listaDePlanos';
import { rotaDaListaDePlanos } from '@/modules/strategy/interface/rotasDaEstrategia';

export const dynamic = 'force-dynamic';

const DESCRICAO = 'Um plano por objetivo. Nada aqui gasta verba nem escreve em conta de anúncios.';

export default async function Estrategia({ params, searchParams }: { readonly params: Promise<{ id: string }>; readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  const { ctx, cliente } = await carregarPainel(id);
  if (!podeVerAEstrategia(ctx.role)) redirect(rotaDoCliente(cliente.id, 'conexoes'));
  const comando = { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role };
  const aviso = <AvisoEfemero erro={primeiro(busca['erro'])} feito={primeiro(busca['feito'])} />;

  const planos = await modules().strategy.service.listarPlanos(comando, { clienteId: cliente.id });
  if (!planos.ok) {
    return (
      <div className="pilha estrategia">
        {aviso}
        <CabecalhoDeSecao titulo="Estratégia" descricao={DESCRICAO} />
        <div className="alert alert--error" role="alert">
          {planos.error.message}
        </div>
      </div>
    );
  }

  const visao = visaoDaLista({ cards: planos.value.cards, papel: ctx.role, clienteId: cliente.id, pediuFormulario: primeiro(busca['novo']) === '1' });

  if (visao.formularioAberto) {
    const modelo = await modules().strategy.service.modeloDeCriacao(comando, { clienteId: cliente.id });
    return (
      <div className="pilha estrategia">
        {aviso}
        <CabecalhoDeSecao titulo="Novo plano" descricao="Você informa a intenção. O agente lê o contexto do cliente e redige o plano; leva alguns minutos." />
        {modelo.ok ? (
          <FormularioDeNovoPlano clienteId={cliente.id} voltarPara={rotaDaListaDePlanos(cliente.id)} inicial={formularioDeNovoPlano(modelo.value, {}, cliente.id)} />
        ) : (
          <div className="alert alert--error" role="alert">
            {modelo.error.message}
          </div>
        )}
      </div>
    );
  }

  const novoPlano = visao.novoPlano.habilitado ? (
    <Link className="btn btn--primary" href={visao.novoPlano.href}>
      Novo plano
    </Link>
  ) : (
    <button type="button" className="btn btn--primary" disabled title={visao.novoPlano.motivo ?? undefined}>
      Novo plano
    </button>
  );

  return (
    <div className="pilha estrategia">
      {aviso}
      <CabecalhoDeSecao titulo="Estratégia" descricao={DESCRICAO} acao={novoPlano} />
      {visao.emAndamento ? <AtualizacaoPeriodica ativa /> : null}
      {visao.cards.length === 0 ? (
        <EstadoVazio titulo={visao.vazio.titulo} texto={visao.vazio.texto} />
      ) : (
        <ul className="planos-lista" aria-label="Planos do cliente">
          {visao.cards.map((card) => (
            <CartaoDePlano key={card.planoId} card={card} clienteId={cliente.id} />
          ))}
        </ul>
      )}
    </div>
  );
}
