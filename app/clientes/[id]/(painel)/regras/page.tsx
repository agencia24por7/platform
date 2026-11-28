import Link from 'next/link';
import { AvisoEfemero } from '@/../app/clientes/[id]/_componentes/AvisoEfemero';
import { CabecalhoDeSecao } from '@/../app/clientes/[id]/_componentes/CabecalhoDeSecao';
import { EstadoVazio } from '@/../app/clientes/[id]/_componentes/EstadoVazio';
import { carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { CartaoDeRegra, type ModoDoCartao } from '@/../app/clientes/[id]/(painel)/regras/CartaoDeRegra';
import { carregarDefinicoes, definicaoDaDecisao, nomesDaEquipe, paraFormulario } from '@/../app/clientes/[id]/(painel)/regras/dados';
import { FormularioDeRegra, type ValoresIniciais } from '@/../app/clientes/[id]/(painel)/regras/FormularioDeRegra';
import { modules } from '@/composition';
import { rotaDaAtividade, rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import {
  agruparPorCategoria,
  descricaoDaSecaoDeRegras,
  fimInclusivo,
  dataParaCampo,
  opcaoDeNatureza,
  podeEscreverEmRegras,
  podeRegistrarOuMexer,
  secaoDeRegras,
  valorParaCampo,
} from '@/modules/clients/domain/painel/regras';
import type { Decisao } from '@/modules/clients/domain/regras/index';
import { noVocabularioDe, vocabularioDe } from '@/modules/organizations/domain/vocabulario';

export const dynamic = 'force-dynamic';

type Busca = Record<string, string | string[] | undefined>;

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

  const listaDeDefinicoes = await carregarDefinicoes(cliente.id);
  const definicaoPorChave = (chave: string | null) => (chave ? (listaDeDefinicoes.find((d) => d.key === chave) ?? null) : null);
  const aba = (s: string, extra: Record<string, string | null | undefined> = {}) => rotaDoCliente(cliente.id, 'regras', { secao: s, ...extra });

  const cartao = (d: Decisao, modo: ModoDoCartao, nomes: ReadonlyMap<string, string>, nivel: 'h3' | 'h4' = 'h3') => (
    <CartaoDeRegra
      key={d.id}
      clienteId={cliente.id}
      decisao={d}
      definicao={definicaoDaDecisao(listaDeDefinicoes, d)}
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
    const [vigentes, propostas, fila] = await Promise.all([servico.listarVigentes(escopo), servico.listarPropostas(escopo), servico.filaDeRevisao(escopo)]);
    const decisoesParaNomes = [...(vigentes.ok ? vigentes.value.decisoes : []), ...(propostas.ok ? propostas.value : []), ...(fila.ok ? fila.value : [])];
    const nomes = await nomesDaEquipe(cliente.id, decisoesParaNomes);
    const grupos = vigentes.ok ? agruparPorCategoria(vigentes.value.decisoes) : [];
    corpo = (
      <div className="regras-painel">
        <div className="pilha regras-painel__principal">
          {!vigentes.ok ? erroDoServico(vigentes.error.message) : null}
          {vigentes.ok && vigentes.value.conflitos.length > 0 ? (
            <div className="alert alert--warn" role="status">
              Há decisões vigentes concorrentes para a mesma chave ({vigentes.value.conflitos.map((c) => `#${c.numero}`).join(', ')}). Vale a mais recente; revise.
            </div>
          ) : null}
          {vigentes.ok && grupos.length === 0 ? vazio('Nada vigente ainda', 'Registre o primeiro limite, regra ou decisão do cliente.') : null}
          {grupos.map((g) => (
            <section key={g.categoria} aria-labelledby={`grupo-${g.categoria}`} className="regras-grupo">
              <h3 id={`grupo-${g.categoria}`} className="regras-grupo__titulo">
                {g.rotulo} <span className="selo-contagem">{g.decisoes.length}</span>
              </h3>
              <div className="regras-lista regras-lista--grade">{g.decisoes.map((d) => cartao(d, 'vigente', nomes, 'h4'))}</div>
            </section>
          ))}
          <Link className="quiet-link" href={rotaDaAtividade(cliente.id, 'regras')}>
            Ver a linha do tempo em Atividade →
          </Link>
        </div>
        <aside className="pilha regras-painel__lateral" aria-label="Pendências de Regras">
          <section className="regras-lateral" aria-labelledby="t-propostas">
            <CabecalhoDeSecao
              id="t-propostas"
              titulo="Propostas de agentes"
              descricao="Agentes propõem; só uma pessoa faz a proposta valer. Limite e regra propostos por agente nunca valem sozinhos."
            />
            {!propostas.ok
              ? erroDoServico(propostas.error.message)
              : propostas.value.length === 0
                ? vazio('Nenhuma proposta esperando decisão')
                : <div className="regras-lista">{propostas.value.map((d) => cartao(d, 'proposta', nomes))}</div>}
          </section>
          <section className="regras-lateral" aria-labelledby="t-revisar">
            <CabecalhoDeSecao
              id="t-revisar"
              titulo="Revisar e converter"
              descricao="Regras em texto livre que trazem número. Converta em limite para o sistema poder impor, ou mantenha como regra alterando-a."
            />
            {!fila.ok ? erroDoServico(fila.error.message) : fila.value.length === 0 ? vazio('Nada para revisar') : <div className="regras-lista">{fila.value.map((d) => cartao(d, 'revisar', nomes))}</div>}
          </section>
        </aside>
      </div>
    );
  } else if (secao === 'historico') {
    const chave = texto('chave') ?? '';
    const escopoDaChave = texto('escopo') ?? null;
    const historico = await servico.historicoDaChave(escopo, { chave, escopo: escopoDaChave });
    if (!historico.ok) {
      corpo = erroDoServico(historico.error.message);
    } else {
      const cadeia = [...historico.value].sort((a, b) => b.decisao.numero - a.decisao.numero);
      const nomes = await nomesDaEquipe(cliente.id, cadeia.map((c) => c.decisao));
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
          <Link className="btn" href={aba('hoje')}>
            Voltar às regras
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
      const nomes = await nomesDaEquipe(cliente.id, [d]);
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

  const descricaoDaSecao = descricaoDaSecaoDeRegras(secao, texto('chave') ?? '');

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
