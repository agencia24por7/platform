import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AvisoEfemero } from '@/../app/clientes/[id]/_componentes/AvisoEfemero';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { AcoesDoPlano } from '@/../app/clientes/[id]/(painel)/estrategia/AcoesDoPlano';
import { Avisos } from '@/../app/clientes/[id]/(painel)/estrategia/Avisos';
import { Bloco } from '@/../app/clientes/[id]/(painel)/estrategia/BlocosDaSecao';
import { BlocoDoPlano } from '@/../app/clientes/[id]/(painel)/estrategia/BlocoDoPlano';
import { brainDaPagina } from '@/../app/clientes/[id]/(painel)/estrategia/_brainDoPlano';
import { EncaixesDoPlano } from '@/../app/clientes/[id]/(painel)/estrategia/EncaixesDoPlano';
import { LinhaDoTempo } from '@/../app/clientes/[id]/(painel)/estrategia/LinhaDoTempo';
import { MemoriaDoPlano } from '@/../app/clientes/[id]/(painel)/estrategia/MemoriaDoPlano';
import { PlanoDeMidia } from '@/../app/clientes/[id]/(painel)/estrategia/PlanoDeMidia';
import { PedidoDoPlano } from '@/../app/clientes/[id]/(painel)/estrategia/PedidoDoPlano';
import { modules } from '@/composition';
import { idValido, rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import { podeVerAEstrategia } from '@/modules/strategy/domain/papeis';
import { memoriaDoPlano, memoriaTemConteudo } from '@/modules/strategy/interface/memoriaDoPlano';
import { rotaDaListaDePlanos, rotaDaMemoriaDoPlano, rotaDoPlano } from '@/modules/strategy/interface/rotasDaEstrategia';
import { ROTULO_DO_LINK_NA_PAGINA_DO_PLANO, rotaDoPlanoDeProducao } from '@/modules/strategy/interface/planoDeProducao';
import { visaoDoPlano } from '@/modules/strategy/interface/visaoDoPlano';

export const dynamic = 'force-dynamic';

export default async function PaginaDoPlano({ params, searchParams }: { readonly params: Promise<{ id: string; planoId: string }>; readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id, planoId }, busca] = await Promise.all([params, searchParams]);
  const { ctx, cliente } = await carregarPainel(id);
  if (!podeVerAEstrategia(ctx.role)) redirect(rotaDoCliente(cliente.id, 'conexoes'));
  if (!idValido(planoId)) notFound();

  const comando = { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role };
  const brain = await brainDaPagina(comando, cliente.id);
  const resultado = await modules().strategy.service.painelDoPlano(
    comando,
    { clienteId: cliente.id, planoId },
    brain.snapshot === undefined ? {} : { snapshotDoBrain: brain.snapshot },
  );
  const painel = resultado.ok ? (resultado.value.planos[0] ?? null) : null;
  if (!resultado.ok || painel === null) notFound();

  const visao = visaoDoPlano({ painel, papel: ctx.role, clienteId: cliente.id, entradasDoBrain: brain.entradas });
  const memoria = memoriaDoPlano({ painel, entradasDoBrain: brain.entradas });
  const aqui = rotaDoPlano(cliente.id, planoId);
  const edicao = visao.acoes.find((acao) => acao.chave === 'editar_secao');

  return (
    <div className="pilha estrategia">
      <AvisoEfemero erro={primeiro(busca['erro'])} feito={primeiro(busca['feito'])} />
      <Link className="estrategia-voltar" href={rotaDaListaDePlanos(cliente.id)}>
        <span aria-hidden="true">←</span> Todos os planos
      </Link>
      <header className="estrategia-cabecalho">
        <h2 className="secao-topo__titulo">{visao.titulo}</h2>
        <p className="estrategia-cabecalho__fatos">
          <span className={`pill ${visao.classe}`}>
            <Icone nome={visao.icone} tamanho={14} />
            {visao.rotuloDoStatus}
          </span>
          <span>{visao.tipoRotulo}</span>
          {visao.foco ? <span>Foco: {visao.foco}</span> : null}
          {visao.plataformas.length > 0 ? <span>{visao.plataformas.join(', ')}</span> : null}
          {visao.versao ? <time dateTime={visao.versao.em.toISOString()}>Atualizado em {visao.versao.emTexto}</time> : null}
        </p>
      </header>
      <Avisos avisos={visao.avisos} />
      {visao.execucao ? <LinhaDoTempo execucao={visao.execucao} atualizarEm={aqui} /> : null}
      <AcoesDoPlano clienteId={cliente.id} visao={visao} />
      <div className="acoes">
        <Link className="btn" href={rotaDoPlanoDeProducao(cliente.id, planoId)}>
          {ROTULO_DO_LINK_NA_PAGINA_DO_PLANO}
        </Link>
      </div>
      {visao.pedido ? <PedidoDoPlano pedido={visao.pedido} /> : null}
      <EncaixesDoPlano clienteId={cliente.id} planoId={planoId} lacunas={visao.lacunas} falhaDoGate={visao.falhaDoGate} />
      {visao.resumo && visao.versao ? (
        <BlocoDoPlano clienteId={cliente.id} planoId={planoId} versaoId={visao.versao.id} bloco={visao.resumo} edicao={edicao}>
          <div className="pilha">
            {visao.resumo.conteudo.map((bloco) => (
              <Bloco key={bloco.rotulo} bloco={bloco} />
            ))}
          </div>
        </BlocoDoPlano>
      ) : null}
      {visao.midia && visao.versao ? (
        <BlocoDoPlano clienteId={cliente.id} planoId={planoId} versaoId={visao.versao.id} bloco={visao.midia} edicao={edicao}>
          <PlanoDeMidia plataformas={visao.midia.conteudo} />
        </BlocoDoPlano>
      ) : null}
      {memoriaTemConteudo(memoria) ? <MemoriaDoPlano memoria={memoria} href={rotaDaMemoriaDoPlano(cliente.id, planoId)} /> : null}
    </div>
  );
}
