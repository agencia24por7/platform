import Link from 'next/link';
import { AvisoEfemero } from '@/../app/clientes/[id]/_componentes/AvisoEfemero';
import { CabecalhoDeSecao } from '@/../app/clientes/[id]/_componentes/CabecalhoDeSecao';
import { EstadoVazio } from '@/../app/clientes/[id]/_componentes/EstadoVazio';
import { SubNavegacao } from '@/../app/clientes/[id]/_componentes/SubNavegacao';
import { carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { FiltrosDaLinha } from '@/../app/clientes/[id]/(painel)/regras/FiltrosDaLinha';
import { CartaoDeRegra } from '@/../app/clientes/[id]/(painel)/regras/CartaoDeRegra';
import { FormularioDeRegra, type DefinicaoDoFormulario, type ValoresIniciais } from '@/../app/clientes/[id]/(painel)/regras/FormularioDeRegra';
import { modules } from '@/composition';
import { rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import {
  ROTULO_DA_CATEGORIA,
  ROTULO_DO_STATUS,
  agruparPorCategoria,
  buscaDaLinha,
  fimInclusivo,
  dataParaCampo,
  lerFiltrosDaLinha,
  opcaoDeNatureza,
  podeEscreverEmRegras,
  podeRegistrarOuMexer,
  secaoDeRegras,
  valorParaCampo,
} from '@/modules/clients/domain/painel/regras';
import { CATEGORIAS, ORIGENS, STATUS, type Decisao } from '@/modules/clients/domain/regras/index';
import type { DefinicaoDoBanco } from '@/modules/clients/infrastructure/regrasRepository';
import { noVocabularioDe, vocabularioDe } from '@/modules/organizations/domain/vocabulario';

export const dynamic = 'force-dynamic';

const ITENS_POR_PAGINA = 20;

type Busca = Record<string, string | string[] | undefined>;

async function nomesDaEquipe(organizationId: string, decisoes: readonly Decisao[]): Promise<ReadonlyMap<string, string>> {
  const ids = new Set(decisoes.map((d) => d.decididoPor).filter((id): id is string => id !== null));
  if (ids.size === 0) return new Map();
  try {
    const { membros } = await modules().team.equipe(organizationId);
    return new Map(membros.filter((m) => ids.has(m.userId)).map((m) => [m.userId, m.name]));
  } catch {
    return new Map();
  }
}

function paraFormulario(d: DefinicaoDoBanco): DefinicaoDoFormulario {
  return {
    key: d.key,
    nome: d.nome,
    descricao: d.descricao,
    categoria: d.categoria,
    unidade: d.unidade,
    periodo: d.periodo,
    sentido: d.sentido,
    faixaMin: d.faixaMin,
    faixaMax: d.faixaMax,
    tiposDeEscopo: d.tiposDeEscopo,
  };
}

export default async function Regras({ params, searchParams }: { readonly params: Promise<{ id: string }>; readonly searchParams: Promise<Busca> }) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  const { ctx, cliente } = await carregarPainel(id);
  const escopo = { organizationId: ctx.organization.id, clientId: cliente.id };
  const servico = modules().regras;
  const vocabulario = vocabularioDe(ctx.organization.type);
  const tipo = ctx.organization.type;
  const papel = ctx.role;
  const podeEscrever = podeEscreverEmRegras(papel);
  const secao = secaoDeRegras(primeiro(busca['secao']));
  const texto = (chave: string) => primeiro(busca[chave]);

  const [definicoes, prontidao] = await Promise.all([servico.listarDefinicoes(escopo), servico.prontidao(escopo)]);
  const listaDeDefinicoes: readonly DefinicaoDoBanco[] = definicoes.ok ? definicoes.value : [];
  const definicaoPorChave = (chave: string | null) => (chave ? (listaDeDefinicoes.find((d) => d.key === chave) ?? null) : null);
  const contagem = prontidao.ok ? prontidao.value : null;
  const aba = (s: string, extra: Record<string, string | null | undefined> = {}) => rotaDoCliente(cliente.id, 'regras', { secao: s, ...extra });

  const itens = [
    { chave: 'hoje', rotulo: 'O que vale hoje', href: aba('hoje') },
    { chave: 'linha', rotulo: 'Linha do tempo', href: aba('linha') },
    { chave: 'propostas', rotulo: 'Propostas de agentes', href: aba('propostas'), contador: contagem?.propostasPendentes ?? null },
    { chave: 'revisar', rotulo: 'Revisar e converter', href: aba('revisar'), contador: contagem?.aRevisar ?? null },
    ...(secao === 'registrar' ? [{ chave: 'registrar', rotulo: 'Registrar', href: aba('registrar') }] : []),
    ...(secao === 'alterar' ? [{ chave: 'alterar', rotulo: 'Alterar', href: aba('alterar', { id: texto('id') }) }] : []),
  ];
  const ativaNaNavegacao: string = secao === 'historico' ? 'linha' : secao;

  const cartao = (d: Decisao, modo: 'vigente' | 'linha' | 'proposta' | 'revisar' | 'historico', nomes: ReadonlyMap<string, string>, nivel: 'h3' | 'h4' = 'h3') => (
    <CartaoDeRegra
      key={d.id}
      clienteId={cliente.id}
      decisao={d}
      definicao={definicaoPorChave(d.natureza === 'limite' ? d.chave : null)}
      nomes={nomes}
      vocabulario={vocabulario}
      papel={papel}
      modo={modo}
      nivelDoTitulo={nivel}
    />
  );
  const vazio = (titulo: string, mensagem?: string) => <EstadoVazio titulo={titulo} texto={mensagem ? noVocabularioDe(tipo, mensagem) : undefined} />;
  const erroDoServico = (mensagem: string) => <div className="alert alert--error">{mensagem}</div>;

  let corpo: React.ReactNode;

  if (secao === 'hoje') {
    const vigentes = await servico.listarVigentes(escopo);
    if (!vigentes.ok) {
      corpo = erroDoServico(vigentes.error.message);
    } else {
      const nomes = await nomesDaEquipe(escopo.organizationId, vigentes.value.decisoes);
      const grupos = agruparPorCategoria(vigentes.value.decisoes);
      corpo = (
        <div className="pilha">
          {vigentes.value.conflitos.length > 0 ? (
            <div className="alert alert--warn" role="status">
              Há decisões vigentes concorrentes para a mesma chave ({vigentes.value.conflitos.map((c) => `#${c.numero}`).join(', ')}). Vale a mais recente; revise.
            </div>
          ) : null}
          {grupos.length === 0
            ? vazio('Nada vigente ainda', 'Registre o primeiro limite, regra ou decisão do cliente.')
            : grupos.map((g) => (
                <section key={g.categoria} aria-labelledby={`grupo-${g.categoria}`} className="regras-grupo">
                  <h3 id={`grupo-${g.categoria}`} className="regras-grupo__titulo">
                    {g.rotulo} <span className="contador">{g.decisoes.length}</span>
                  </h3>
                  <div className="regras-lista">{g.decisoes.map((d) => cartao(d, 'vigente', nomes, 'h4'))}</div>
                </section>
              ))}
        </div>
      );
    }
  } else if (secao === 'linha') {
    const filtros = lerFiltrosDaLinha({
      categoria: texto('categoria'),
      origem: texto('origem'),
      status: texto('status'),
      cursor: texto('cursor'),
    });
    const pagina = await servico.linhaDoTempo(escopo, { ...filtros, limite: ITENS_POR_PAGINA });
    if (!pagina.ok) {
      corpo = erroDoServico(pagina.error.message);
    } else {
      const nomes = await nomesDaEquipe(escopo.organizationId, pagina.value.itens);
      const semCursor = { categoria: filtros.categoria, origem: filtros.origem, status: filtros.status };
      corpo = (
        <div className="pilha">
          <FiltrosDaLinha action={rotaDoCliente(cliente.id, 'regras')} rotulo="Filtrar a linha do tempo">
            <input type="hidden" name="secao" value="linha" />
            <label className="field">
              <span className="field__label">Categoria</span>
              <select className="select" name="categoria" defaultValue={filtros.categoria ?? ''}>
                <option value="">Todas</option>
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {ROTULO_DA_CATEGORIA[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Origem</span>
              <select className="select" name="origem" defaultValue={filtros.origem ?? ''}>
                <option value="">Todas</option>
                {ORIGENS.map((o) => (
                  <option key={o} value={o}>
                    {o === 'cliente' ? vocabulario.origemCliente : o === 'agencia' ? vocabulario.origemEquipe : 'Agente'}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Status</span>
              <select className="select" name="status" defaultValue={filtros.status ?? ''}>
                <option value="">Todos</option>
                {STATUS.map((s) => (
                  <option key={s} value={s}>
                    {ROTULO_DO_STATUS[s]}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <noscript>
                <button className="btn btn--primary" type="submit">
                  Filtrar
                </button>
              </noscript>
              <Link className="btn" href={aba('linha')}>
                Limpar
              </Link>
            </div>
          </FiltrosDaLinha>
          {pagina.value.itens.length === 0 ? (
            vazio('Nenhum registro', 'Nenhum registro com estes filtros.')
          ) : (
            <ol className="regras-lista regras-lista--linha" aria-label="Decisões, da mais recente para a mais antiga">
              {pagina.value.itens.map((d) => (
                <li key={d.id}>{cartao(d, 'linha', nomes)}</li>
              ))}
            </ol>
          )}
          <nav className="regras-paginas" aria-label="Paginação da linha do tempo">
            {filtros.cursor !== null ? (
              <Link className="btn" href={rotaDoCliente(cliente.id, 'regras', buscaDaLinha(semCursor, null))}>
                Voltar ao início
              </Link>
            ) : null}
            {pagina.value.proximoCursor !== null ? (
              <Link className="btn" rel="next" href={rotaDoCliente(cliente.id, 'regras', buscaDaLinha(semCursor, pagina.value.proximoCursor))}>
                Ver mais antigas
              </Link>
            ) : null}
          </nav>
        </div>
      );
    }
  } else if (secao === 'propostas') {
    const propostas = await servico.listarPropostas(escopo);
    if (!propostas.ok) {
      corpo = erroDoServico(propostas.error.message);
    } else {
      const nomes = await nomesDaEquipe(escopo.organizationId, propostas.value);
      corpo = (
        <div className="pilha">
          {propostas.value.length === 0 ? vazio('Nenhuma proposta esperando decisão') : <div className="regras-lista">{propostas.value.map((d) => cartao(d, 'proposta', nomes))}</div>}
        </div>
      );
    }
  } else if (secao === 'revisar') {
    const fila = await servico.filaDeRevisao(escopo);
    if (!fila.ok) {
      corpo = erroDoServico(fila.error.message);
    } else {
      const nomes = await nomesDaEquipe(escopo.organizationId, fila.value);
      corpo = (
        <div className="pilha">
          {fila.value.length === 0 ? vazio('Nada para revisar') : <div className="regras-lista">{fila.value.map((d) => cartao(d, 'revisar', nomes))}</div>}
        </div>
      );
    }
  } else if (secao === 'historico') {
    const chave = texto('chave') ?? '';
    const escopoDaChave = texto('escopo') ?? null;
    const historico = await servico.historicoDaChave(escopo, { chave, escopo: escopoDaChave });
    if (!historico.ok) {
      corpo = erroDoServico(historico.error.message);
    } else {
      const cadeia = [...historico.value].sort((a, b) => b.decisao.numero - a.decisao.numero);
      const nomes = await nomesDaEquipe(escopo.organizationId, cadeia.map((c) => c.decisao));
      corpo = (
        <div className="pilha">
          {cadeia.length === 0 ? (
            vazio('Sem histórico', 'Sem histórico para esta chave.')
          ) : (
            <ol className="regras-lista regras-cadeia" aria-label="Versões da regra">
              {cadeia.map(({ decisao, eventos }) => (
                <li key={decisao.id}>
                  {cartao(decisao, 'historico', nomes)}
                  {eventos.length > 0 ? (
                    <ul className="regras-eventos" aria-label={`Eventos da decisão #${decisao.numero}`}>
                      {eventos.map((e) => (
                        <li key={e.id}>
                          <time dateTime={e.em.toISOString()}>{e.em.toLocaleString('pt-BR')}</time> · {ROTULO_DO_EVENTO[e.tipo]}
                          {e.motivo ? `: ${e.motivo}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          <Link className="btn" href={aba('linha')}>
            Voltar à linha do tempo
          </Link>
        </div>
      );
    }
  } else if (secao === 'registrar') {
    if (!podeEscrever) {
      corpo = <div className="alert alert--warn">Seu papel só permite ler as regras.</div>;
    } else {
      let contextoInicial: string | undefined;
      const origemId = texto('origem');
      if (origemId) {
        const origem = await servico.detalhe(escopo, { id: origemId });
        if (origem.ok) contextoInicial = `Convertido da regra #${origem.value.numero}: ${origem.value.texto ?? origem.value.titulo}`.slice(0, 2000);
      }
      const natureza = opcaoDeNatureza(texto('natureza'));
      const inicial: ValoresIniciais = {
        ...(natureza && (natureza !== 'limite' || podeRegistrarOuMexer(papel, 'limite')) ? { natureza } : {}),
        ...(texto('definicao') ? { definicao: texto('definicao') } : {}),
        ...(contextoInicial ? { contexto: contextoInicial } : {}),
      };
      corpo = (
        <FormularioDeRegra
          modo="registrar"
          clienteId={cliente.id}
          voltarPara={aba('hoje')}
          definicoes={listaDeDefinicoes.filter((d) => d.ativo).map(paraFormulario)}
          podeLimite={podeRegistrarOuMexer(papel, 'limite')}
          inicial={inicial}
          avisoDoVocabulario={vocabulario.semConfirmacaoDoAnunciante}
        />
      );
    }
  } else {
    const atual = await servico.detalhe(escopo, { id: texto('id') ?? '' });
    if (!atual.ok) {
      corpo = erroDoServico(atual.error.message);
    } else if (atual.value.status !== 'vigente' || atual.value.chave === null) {
      corpo = <div className="alert alert--warn">Só se altera o que está vigente e tem chave. Para corrigir outro caso, registre uma nova decisão.</div>;
    } else if (!podeRegistrarOuMexer(papel, atual.value.natureza)) {
      corpo = (
        <div className="alert alert--warn">
          {atual.value.natureza === 'limite' ? 'Só quem administra altera um limite.' : 'Seu papel só permite ler as regras.'}
        </div>
      );
    } else {
      const d = atual.value;
      const inicial: ValoresIniciais = {
        natureza: d.natureza,
        ...(d.chave ? { definicao: d.chave } : {}),
        ...(d.valor ? { valor: valorParaCampo(d.valor) } : {}),
        titulo: d.titulo,
        ...(d.texto ? { texto: d.texto } : {}),
        forca: d.forca,
        ...(d.vigenciaFim ? { vigenciaFim: dataParaCampo(fimInclusivo(d.vigenciaFim)) } : {}),
      };
      const nomes = await nomesDaEquipe(escopo.organizationId, [d]);
      const definicaoDoLimite = d.natureza === 'limite' ? definicaoPorChave(d.chave) : null;
      corpo = (
        <div className="pilha">
          <section aria-label="Valor atual">
            <p className="regras-grupo__titulo">Valor atual</p>
            {cartao(d, 'historico', nomes)}
          </section>
          <FormularioDeRegra
            modo="alterar"
            clienteId={cliente.id}
            decisaoId={d.id}
            voltarPara={aba('hoje')}
            definicoes={definicaoDoLimite ? [paraFormulario(definicaoDoLimite)] : []}
            podeLimite={podeRegistrarOuMexer(papel, 'limite')}
            inicial={inicial}
            avisoDoVocabulario={vocabulario.semConfirmacaoDoAnunciante}
          />
        </div>
      );
    }
  }

  const descricaoDaSecao: React.ReactNode =
    secao === 'propostas'
      ? 'Agentes propõem; só uma pessoa faz a proposta valer. Limite e regra propostos por agente nunca valem sozinhos.'
      : secao === 'revisar'
        ? 'Regras em texto livre que trazem número. Converta em limite para o sistema poder impor, ou mantenha como regra alterando-a.'
        : secao === 'historico'
          ? `Versões de ${texto('chave') ?? ''}, da atual à primeira.`
          : secao === 'registrar'
            ? 'Registre um limite, uma regra ou uma decisão do cliente.'
            : secao === 'alterar'
              ? 'Alterar cria uma nova versão; a anterior fica no histórico.'
              : 'Limites, regras e decisões vigentes, com histórico de cada mudança.';

  return (
    <div className="pilha regras">
      <AvisoEfemero erro={texto('erro')} feito={texto('feito')} />
      <CabecalhoDeSecao
        titulo="Regras"
        descricao={descricaoDaSecao}
        acao={
          podeEscrever && secao !== 'registrar' && secao !== 'alterar' ? (
            <Link className="btn btn--primary" href={aba('registrar')}>
              Registrar
            </Link>
          ) : null
        }
      />
      <SubNavegacao rotulo="Seções de Regras" ativa={ativaNaNavegacao} itens={itens} />
      {corpo}
    </div>
  );
}

const ROTULO_DO_EVENTO = {
  proposta: 'Proposta registrada',
  efetivada: 'Efetivada',
  rejeitada: 'Rejeitada',
  superada: 'Substituída por nova versão',
  revogada: 'Revogada',
  redigida: 'Conteúdo redigido (LGPD)',
} as const;
