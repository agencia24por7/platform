import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { CopyButton } from '@/../app/_components/CopyButton';
import { CabecalhoDeSecao } from '@/../app/clientes/[id]/_componentes/CabecalhoDeSecao';
import { EstadoVazio } from '@/../app/clientes/[id]/_componentes/EstadoVazio';
import { Anel } from '@/../app/clientes/[id]/_componentes/Anel';
import { buscarBrainDoCliente } from '@/../app/clientes/[id]/_brain/fonte';
import { carregarContexto, carregarPainel } from '@/../app/clientes/[id]/_dados';
import { ExploradorDoBrain } from '@/../app/clientes/[id]/(painel)/contexto/brain/ExploradorDoBrain';
import { separarPorPreenchimento } from '@/modules/clients/domain/painel/brain/preenchimento';
import { montarMapa } from '@/modules/clients/domain/painel/brain/mapa';
import { ROTULO_DO_FRESCOR, type Capacidade } from '@/modules/clients/domain/painel/brain/tipos';
import { tempoRelativo } from '@/modules/clients/domain/painel/resumo';

const ESTADO: Record<Capacidade['estado'], { readonly rotulo: string; readonly classe: string }> = {
  disponivel: { rotulo: 'Disponível', classe: 'pill--ok' },
  parcial: { rotulo: 'Parcial', classe: 'pill--warn' },
  indisponivel: { rotulo: 'Indisponível', classe: '' },
};

const ROTULO_DO_BRAIN: Record<string, string> = {
  desativado: 'Armazenamento não configurado',
  nunca_publicado: 'Ainda não publicado',
  em_dia: 'Publicado e em dia',
  pendente: 'Publicação pendente',
  com_erro: 'Última publicação falhou',
};

const IMPACTO = { 3: 'Alto impacto', 2: 'Médio impacto', 1: 'Baixo impacto' } as const;

function emLinha(texto: string): ReactNode[] {
  return texto.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((parte, i) => {
    if (parte.startsWith('`') && parte.endsWith('`')) return <code key={i}>{parte.slice(1, -1)}</code>;
    if (parte.startsWith('**') && parte.endsWith('**')) return <strong key={i}>{parte.slice(2, -2)}</strong>;
    return parte;
  });
}

function MarkdownDoCatalogo({ texto }: { readonly texto: string }) {
  const linhas = texto.split('\n');
  const blocos: ReactNode[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]!;
    if (linha.startsWith('### ')) blocos.push(<h5 key={i}>{emLinha(linha.slice(4))}</h5>);
    else if (linha.startsWith('## ')) blocos.push(<h4 key={i}>{emLinha(linha.slice(3))}</h4>);
    else if (linha.startsWith('# ')) blocos.push(<h3 key={i}>{emLinha(linha.slice(2))}</h3>);
    else if (linha.startsWith('- ')) {
      const itens: string[] = [];
      while (i < linhas.length && linhas[i]!.startsWith('- ')) itens.push(linhas[i++]!.slice(2));
      i -= 1;
      blocos.push(<ul key={i}>{itens.map((t, j) => <li key={j}>{emLinha(t)}</li>)}</ul>);
    } else if (linha.startsWith('| ')) {
      const filas: string[][] = [];
      while (i < linhas.length && linhas[i]!.startsWith('| ')) {
        filas.push(linhas[i++]!.slice(2, -2).split(/ (?<!\\)\| /));
      }
      i -= 1;
      const [cabeca, , ...corpo] = filas;
      blocos.push(
        <div key={i} className="table-wrap">
          <table className="table">
            <thead><tr>{cabeca?.map((c, j) => <th key={j}>{emLinha(c)}</th>)}</tr></thead>
            <tbody>{corpo.map((f, j) => <tr key={j}>{f.map((c, k) => <td key={k}>{emLinha(c.replace(/\\\|/g, '|'))}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
    } else if (linha.trim()) blocos.push(<p key={i}>{emLinha(linha)}</p>);
  }
  return (
    <div className="markdown" tabIndex={0} role="region" aria-label="Conteúdo do catalogo.md">
      {blocos}
    </div>
  );
}

export async function BrainView({ clienteId }: { readonly clienteId: string }) {
  const { ctx, cliente } = await carregarPainel(clienteId);
  const buscado = await buscarBrainDoCliente({ organizationId: ctx.organization.id, clientId: cliente.id });
  if (!buscado.ok && buscado.motivo === 'nao_encontrado') notFound();
  if (!buscado.ok) {
    return (
      <EstadoVazio
        titulo="O Brain não respondeu agora"
        texto="O índice deste cliente é montado na hora a partir das conexões, coletas e contexto. Tente de novo em instantes; se persistir, avise o time técnico."
      />
    );
  }
  const brain = buscado.brain;
  const contexto = await carregarContexto(ctx.organization.id, cliente.id);
  const mapa = montarMapa(brain);
  const agora = new Date();
  const totalPreenchidas = separarPorPreenchimento(brain.entradas).preenchidas.length;
  const tabelas = brain.entradas.filter((e) => e.tipo === 'tabela_de_dados' && e.cobertura.ultimos90Dias);

  return (
    <div className="brain pilha">
      <CabecalhoDeSecao titulo="Brain" descricao="Só leitura: o que o motor enxerga. Para editar, use o Mapa de contexto." />
      <dl className="fatos">
        <div className="fatos__item">
          <dt className="fatos__rotulo">Brain publicado</dt>
          <dd>{contexto ? (ROTULO_DO_BRAIN[contexto.brain.situacao] ?? contexto.brain.situacao) : '—'}</dd>
        </div>
        {contexto?.brain.exportadoEm ? (
          <div className="fatos__item">
            <dt className="fatos__rotulo">Última publicação</dt>
            <dd>{contexto.brain.exportadoEm.toLocaleString('pt-BR')}</dd>
          </div>
        ) : null}
      </dl>
      {brain.origem === 'exemplo' ? (
        <p className="faixa-de-exemplo" role="note">
          <strong>Prévia.</strong> Conexões e contexto são reais; cobertura, frescor das tabelas e esquemas são de exemplo até o
          módulo Brain entrar no ar.
        </p>
      ) : null}

      <section className="pulso" aria-labelledby="t-pulso">
        <div className="pulso__anel">
          <Anel valor={brain.pulso.saude} rotulo="Saúde do Brain" tamanho={148} espessura={12} tom={brain.pulso.saude >= 70 ? 'ok' : brain.pulso.saude >= 40 ? 'acento' : 'alerta'} />
        </div>
        <div className="pulso__texto">
          <span className="eyebrow">Pulso do Brain</span>
          <h2 className="pulso__titulo" id="t-pulso">
            Tudo o que sabemos sobre {cliente.name}, num índice só.
          </h2>
          <p className="subtle small">
            {totalPreenchidas} {totalPreenchidas === 1 ? 'entrada preenchida' : 'entradas preenchidas'} · atualizado {tempoRelativo(new Date(brain.atualizadoEm), agora)} · versão{' '}
            <span className="mono">{brain.versao}</span>
          </p>
          <dl className="pulso__medidas">
            <div className="medida">
              <dt>Cobertura</dt>
              <dd>{brain.pulso.cobertura}%</dd>
              <dd className="medida__ajuda">dias com dado nos últimos 90</dd>
            </div>
            <div className="medida">
              <dt>Frescor</dt>
              <dd>{brain.pulso.frescor}%</dd>
              <dd className="medida__ajuda">conexões coletando em dia</dd>
            </div>
            <div className="medida">
              <dt>Contexto</dt>
              <dd>{brain.pulso.completudeDoContexto}%</dd>
              <dd className="medida__ajuda">mapa de contexto preenchido</dd>
            </div>
          </dl>
        </div>
      </section>

      <ExploradorDoBrain clienteNome={cliente.name} entradas={brain.entradas} mapa={mapa} />

      <div className="brain__grade">
        <section className="card" aria-labelledby="t-capacidades">
          <div className="card__head">
            <h2 className="card__title" id="t-capacidades">O que o Brain consegue responder</h2>
          </div>
          <ul className="capacidades">
            {brain.capacidades.map((c) => (
              <li key={c.id} className={`capacidade capacidade--${c.estado}`}>
                <div className="capacidade__topo">
                  <span className="capacidade__pergunta">{c.pergunta}</span>
                  <span className={`pill ${ESTADO[c.estado].classe}`}>{ESTADO[c.estado].rotulo}</span>
                </div>
                {c.falta.length > 0 ? <p className="subtle small">Falta: {c.falta.join(' · ')}</p> : <p className="subtle small">Com base em {c.evidencias.length} entrada(s).</p>}
                {c.acao ? (
                  <Link className="quiet-link capacidade__acao" href={c.acao.href}>
                    {c.acao.rotulo} →
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="t-fila">
          <div className="card__head">
            <h2 className="card__title" id="t-fila">Próximas ações</h2>
            <span className="card__sub">por impacto</span>
          </div>
          {brain.acoes.length === 0 ? (
            <EstadoVazio titulo="Nada pendente" />
          ) : (
            <ol className="acoes-lista">
              {brain.acoes.map((a) => (
                <li key={a.id} className={`acao acao--${a.impacto === 3 ? 'alta' : 'media'}`}>
                  <div className="acao__texto">
                    <span className="acao__titulo">{a.titulo}</span>
                    <span className="acao__porque">{IMPACTO[a.impacto]} · {a.porque}</span>
                  </div>
                  <Link className="btn btn--compacto" href={a.href}>{a.rotulo}</Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <details className="card brain-recolhivel">
        <summary className="card__head">
          <h2 className="card__title" id="t-cobertura">Linha de cobertura</h2>
          <span className="card__sub">últimos 90 dias · cada traço é um dia</span>
        </summary>
        {tabelas.length === 0 ? (
          <EstadoVazio titulo="Nenhuma tabela coletada ainda" />
        ) : (
          <ul className="faixas">
            {tabelas.map((t) => {
              const dias = t.cobertura.ultimos90Dias ?? [];
              return (
                <li key={t.urn} className="faixa">
                  <span className="faixa__nome">
                    <span className="strong small">{t.titulo}</span>
                    <span className="subtle xsmall">{t.cobertura.diasComDado ?? 0}/90 dias · {ROTULO_DO_FRESCOR[t.frescor.status]}</span>
                  </span>
                  <svg className="faixa__mapa" viewBox="0 0 90 10" preserveAspectRatio="none" role="img" aria-label={`${t.titulo}: ${t.cobertura.diasComDado ?? 0} de 90 dias com dado`}>
                    {dias.map((tem, i) => (
                      <rect key={i} x={i} y="0" width="0.82" height="10" className={tem ? 'faixa__dia faixa__dia--tem' : 'faixa__dia'} />
                    ))}
                  </svg>
                </li>
              );
            })}
          </ul>
        )}
      </details>

      <details className="card agente brain-recolhivel">
        <summary className="card__head">
          <h2 className="card__title" id="t-agente">Como um agente enxerga</h2>
          <span className="card__sub mono">catalogo.md · hash {brain.hash}</span>
        </summary>
        <div className="card__head">
          <CopyButton texto={brain.catalogoMd} rotulo="Copiar catalogo.md" />
        </div>
        <div className="card__body">
          <MarkdownDoCatalogo texto={brain.catalogoMd} />
          <details className="disclosure">
            <summary>Ver o texto cru</summary>
            <pre className="receita">{brain.catalogoMd}</pre>
          </details>
        </div>
      </details>
    </div>
  );
}
