import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AvisoEfemero } from '@/../app/clientes/[id]/_componentes/AvisoEfemero';
import { CabecalhoDeSecao } from '@/../app/clientes/[id]/_componentes/CabecalhoDeSecao';
import { EstadoVazio } from '@/../app/clientes/[id]/_componentes/EstadoVazio';
import { SubNavegacao } from '@/../app/clientes/[id]/_componentes/SubNavegacao';
import { montarSnapshotDoCliente } from '@/../app/clientes/[id]/_brain/fonte';
import { carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { AcoesDoPlano } from '@/../app/clientes/[id]/(painel)/estrategia/AcoesDoPlano';
import { AtualizacaoPeriodica } from '@/../app/clientes/[id]/(painel)/estrategia/AtualizacaoPeriodica';
import { FormularioDeIntencao } from '@/../app/clientes/[id]/(painel)/estrategia/FormularioDeIntencao';
import { Avisos, PlanoEmLeitura } from '@/../app/clientes/[id]/(painel)/estrategia/PlanoEmLeitura';
import { SecaoComite, SecaoGates, SecaoHistorico } from '@/../app/clientes/[id]/(painel)/estrategia/SecoesDeLeitura';
import { modules } from '@/composition';
import type { OpcoesDoPainel } from '@/modules/strategy/application/estrategiaService';
import type { ComandoDeEstrategia } from '@/modules/strategy/application/estrategiaService';
import { rotaDoCliente, secaoDeEstrategia, type SecaoDeEstrategia } from '@/modules/clients/domain/painel/enderecos';
import { podeVerAEstrategia } from '@/modules/strategy/domain/papeis';
import { ROTULO_DO_TIPO_DE_PLANO, TIPOS_DE_PLANO, ehTipoDePlano } from '@/modules/strategy/domain/tipoDePlano';
import { seletorDeTipos } from '@/modules/strategy/interface/seletorDeTipos';
import { visaoDoPlano, type EntradaDoBrainConhecida } from '@/modules/strategy/interface/visaoDoPlano';

export const dynamic = 'force-dynamic';

type Busca = Record<string, string | string[] | undefined>;

type BrainDaPagina = {
  readonly entradas: ReadonlyMap<string, EntradaDoBrainConhecida>;
  readonly snapshot: OpcoesDoPainel['snapshotDoBrain'];
};

async function brainDaPagina(comando: ComandoDeEstrategia, clientId: string): Promise<BrainDaPagina> {
  try {
    const montado = await montarSnapshotDoCliente(comando.organizationId, clientId, comando.papelDeQuemAge);
    if (!montado.ok) return { entradas: new Map(), snapshot: 'indisponivel' };
    return {
      entradas: new Map(montado.value.entradas.map((entrada) => [entrada.urn, {
        titulo: entrada.titulo,
        nota: entrada.evidencia?.nota ?? null,
        ...(entrada.evidencia ? { categoria: entrada.evidencia.categoria } : {}),
        ...(entrada.evidencia?.validoAte ? { validoAte: entrada.evidencia.validoAte } : {}),
        ...(entrada.evidencia?.verificadoEm ? { verificadoEm: entrada.evidencia.verificadoEm } : {}),
      }])),
      snapshot: montado.value,
    };
  } catch {
    return { entradas: new Map(), snapshot: 'indisponivel' };
  }
}

async function nomesDaEquipe(organizationId: string, ids: ReadonlySet<string>): Promise<ReadonlyMap<string, string>> {
  if (ids.size === 0) return new Map();
  try {
    const { membros } = await modules().team.equipe(organizationId);
    return new Map(membros.filter((membro) => ids.has(membro.userId)).map((membro) => [membro.userId, membro.name]));
  } catch {
    return new Map();
  }
}

const DESCRICAO_DA_SECAO: Record<SecaoDeEstrategia, string> = {
  plano: 'O plano de marketing lido do Brain, com as evidências de cada afirmação. Nada aqui gasta verba nem escreve em conta.',
  comite: 'O parecer de cada persona do Comitê e o que o ajuste acatou ou não.',
  gates: 'As checagens que o plano precisa passar antes de ir para autorização.',
  historico: 'Versões do plano e eventos, em ordem.',
};

export default async function Estrategia({ params, searchParams }: { readonly params: Promise<{ id: string }>; readonly searchParams: Promise<Busca> }) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  const { ctx, cliente } = await carregarPainel(id);
  if (!podeVerAEstrategia(ctx.role)) redirect(rotaDoCliente(cliente.id, 'conexoes'));
  const secao = secaoDeEstrategia(primeiro(busca['secao']));
  const tipoPedido = primeiro(busca['tipo']);
  const abrirFormulario = primeiro(busca['novo']) === '1';
  const aba = (s: string, extra: Record<string, string | null | undefined> = {}) => rotaDoCliente(cliente.id, 'estrategia', { secao: s, ...extra });

  const comando: ComandoDeEstrategia = { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role };
  const tipoEscolhido = ehTipoDePlano(tipoPedido) ? tipoPedido : null;
  const brain = await brainDaPagina(comando, cliente.id);
  const resultado = await modules().strategy.service.painelDoPlano(
    comando,
    { clienteId: cliente.id },
    brain.snapshot === undefined ? {} : { snapshotDoBrain: brain.snapshot },
  );

  if (!resultado.ok) {
    return (
      <div className="pilha estrategia">
        <AvisoEfemero erro={primeiro(busca['erro'])} feito={primeiro(busca['feito'])} />
        <CabecalhoDeSecao titulo="Estratégia" descricao={DESCRICAO_DA_SECAO[secao]} />
        <div className="alert alert--error" role="alert">
          {resultado.error.message}
        </div>
      </div>
    );
  }

  const { planos, resumos } = resultado.value;
  const painel = tipoEscolhido ? (planos.find((p) => p.plano.tipo === tipoEscolhido) ?? null) : (planos.find((p) => p.versaoExibida !== null) ?? planos[0] ?? null);

  const ids = new Set<string>();
  for (const versao of painel?.historico.versoes ?? []) if (versao.autorUsuarioId) ids.add(versao.autorUsuarioId);
  for (const evento of painel?.historico.eventos ?? []) if (evento.atorUsuarioId) ids.add(evento.atorUsuarioId);
  const nomes = await nomesDaEquipe(ctx.organization.id, ids);
  const entradas = painel?.versaoExibida && secao === 'plano' ? brain.entradas : new Map<string, EntradaDoBrainConhecida>();

  const visao = visaoDoPlano({ painel, papel: ctx.role, clienteId: cliente.id, entradasDoBrain: entradas, nomes });
  const tipoDoPlano = painel ? (ROTULO_DO_TIPO_DE_PLANO[painel.plano.tipo as keyof typeof ROTULO_DO_TIPO_DE_PLANO] ?? painel.plano.tipo) : '';
  const tipoNaRota = painel?.plano.tipo ?? tipoEscolhido;
  const tiposComPlano = resumos.map((r) => r.tipo);
  const tiposDisponiveis = TIPOS_DE_PLANO.filter((tipo) => !resumos.some((r) => r.tipo === tipo && r.status !== null));
  const seletor = seletorDeTipos({ clienteId: cliente.id, secao, tiposComPlano, selecionado: tipoNaRota });
  const novoPlano = visao.acoes.find((acao) => acao.chave === 'novo_plano');
  const formularioAberto = abrirFormulario && secao === 'plano' && !visao.temPlano && novoPlano?.habilitada === true;

  const itens = [
    { chave: 'plano', rotulo: 'Plano', href: aba('plano', { tipo: tipoNaRota }) },
    { chave: 'comite', rotulo: 'Comitê', href: aba('comite', { tipo: tipoNaRota }), contador: visao.pontosPendentesDoComite },
    { chave: 'gates', rotulo: 'Gates', href: aba('gates', { tipo: tipoNaRota }), contador: visao.checagensReprovadas },
    { chave: 'historico', rotulo: 'Histórico', href: aba('historico', { tipo: tipoNaRota }) },
  ];

  const acaoPrincipal =
    secao === 'plano' && !visao.temPlano && !formularioAberto && novoPlano ? (
      novoPlano.habilitada ? (
        <Link className="btn btn--primary" href={aba('plano', { novo: '1', tipo: tipoNaRota })}>
          Novo plano
        </Link>
      ) : (
        <button type="button" className="btn btn--primary" disabled title={novoPlano.motivos[0]}>
          Novo plano
        </button>
      )
    ) : null;

  let corpo: React.ReactNode;
  if (secao === 'plano') {
    if (formularioAberto) {
      corpo = <FormularioDeIntencao clienteId={cliente.id} voltarPara={aba('plano', { tipo: tipoNaRota })} tipoInicial={tipoNaRota ?? tiposDisponiveis[0] ?? 'aquisicao'} tiposDisponiveis={tiposDisponiveis} />;
    } else if (!visao.temPlano) {
      corpo = (
        <div className="pilha">
          <Avisos avisos={visao.avisos} />
          {visao.execucao ? (
            <div className="card estrategia-execucao" role="status">
              <AtualizacaoPeriodica ativa={!visao.execucao.parada} />
              <div className="card__body">
                <p className="card__title">{visao.execucao.titulo}</p>
                <p>
                  Etapa atual: {visao.execucao.etapaAtual}. A tela se atualiza sozinha. <Link href={aba('plano', { tipo: tipoNaRota })}>Atualizar agora</Link>
                </p>
              </div>
            </div>
          ) : (
            <EstadoVazio
              titulo={visao.versoes.length > 0 ? 'Este cliente não tem plano em vigor' : 'Este cliente ainda não tem plano'}
              texto={
                visao.somenteLeitura
                  ? 'Quem opera ou administra pode pedir o primeiro plano.'
                  : 'Informe a intenção (objetivo, horizonte, ousadia, retorno esperado e verba). O agente lê o Brain e redige o plano.'
              }
            />
          )}
          <AcoesDoPlano clienteId={cliente.id} visao={visao} />
          {novoPlano && !novoPlano.habilitada && novoPlano.motivos.length > 0 ? <p className="subtle">{novoPlano.motivos.join(' ')}</p> : null}
        </div>
      );
    } else {
      corpo = (
        <PlanoEmLeitura
          clienteId={cliente.id}
          visao={visao}
          tipoDoPlano={tipoDoPlano}
          atualizarEm={aba('plano', { tipo: tipoNaRota })}
        />
      );
    }
  } else if (secao === 'comite') {
    corpo = <SecaoComite visao={visao} />;
  } else if (secao === 'gates') {
    corpo = <SecaoGates visao={visao} />;
  } else {
    corpo = <SecaoHistorico visao={visao} />;
  }

  return (
    <div className="pilha estrategia">
      <AvisoEfemero erro={primeiro(busca['erro'])} feito={primeiro(busca['feito'])} />
      <CabecalhoDeSecao titulo="Estratégia" descricao={DESCRICAO_DA_SECAO[secao]} acao={acaoPrincipal} />
      <SubNavegacao rotulo="Seções de Estratégia" ativa={secao} itens={itens} />
      {seletor.mostrar ? (
        <nav className="estrategia-tipos" aria-label="Tipo de plano">
          <ul>
            {seletor.existentes.map((item) => (
              <li key={item.tipo}>
                <Link className="pill" href={item.href} aria-current={item.selecionado ? 'page' : undefined}>
                  {item.rotulo}
                </Link>
              </li>
            ))}
            {seletor.novos.map((item) => (
              <li key={item.tipo}>
                <Link className="pill estrategia-tipos__novo" href={item.href} aria-current={item.selecionado ? 'page' : undefined}>
                  Novo plano de {item.rotulo.toLowerCase()}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {corpo}
    </div>
  );
}
