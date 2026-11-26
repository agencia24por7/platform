import Link from 'next/link';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { AcoesDoPlano } from '@/../app/clientes/[id]/(painel)/estrategia/AcoesDoPlano';
import { AtualizacaoPeriodica } from '@/../app/clientes/[id]/(painel)/estrategia/AtualizacaoPeriodica';
import { Bloco } from '@/../app/clientes/[id]/(painel)/estrategia/BlocosDaSecao';
import { EditorDeSecao } from '@/../app/clientes/[id]/(painel)/estrategia/EditorDeSecao';
import type { AvisoDaVisao, VisaoDoPlano } from '@/modules/strategy/interface/visaoDoPlano';

const CLASSE_DO_AVISO = { info: 'alert--info', warn: 'alert--warn', danger: 'alert--error' } as const;

export function Avisos({ avisos }: { readonly avisos: readonly AvisoDaVisao[] }) {
  if (avisos.length === 0) return null;
  return (
    <div className="pilha estrategia-avisos">
      {avisos.map((aviso) => (
        <div key={aviso.chave} className={`alert ${CLASSE_DO_AVISO[aviso.tom]}`} role={aviso.tom === 'danger' ? 'alert' : 'status'}>
          <Icone nome={aviso.tom === 'danger' ? 'erro' : aviso.tom === 'warn' ? 'atencao' : 'orienta'} />
          <div className="estrategia-aviso">
            <p className="estrategia-aviso__titulo">{aviso.titulo}</p>
            {aviso.texto ? <p>{aviso.texto}</p> : null}
            {aviso.itens.length > 0 ? (
              <ul className="estrategia-aviso__itens">
                {aviso.itens.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {aviso.link ? (
              <Link className="btn btn--compacto" href={aviso.link.href}>
                {aviso.link.rotulo}
              </Link>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function Execucao({ visao, atualizarEm }: { readonly visao: VisaoDoPlano; readonly atualizarEm: string }) {
  const execucao = visao.execucao;
  if (!execucao) return null;
  return (
    <section className="card estrategia-execucao" aria-label="Andamento da execução">
      <AtualizacaoPeriodica ativa={!execucao.parada} />
      <div className="card__body">
        <p className="card__title">{execucao.titulo}</p>
        <ol className="etapas">
          {execucao.etapas.map((etapa) => (
            <li key={etapa.chave} className={`etapas__item etapas__item--${etapa.estado}`} aria-current={etapa.estado === 'atual' ? 'step' : undefined}>
              <Icone nome={etapa.estado === 'feita' ? 'ok' : etapa.estado === 'atual' ? 'reautorizar' : 'vazio'} tamanho={14} />
              <span>{etapa.rotulo}</span>
              <span className="sr-only">{etapa.estado === 'feita' ? ' (concluída)' : etapa.estado === 'atual' ? ' (em andamento)' : ' (a fazer)'}</span>
            </li>
          ))}
        </ol>
        <p className="field__hint">
          A tela se atualiza sozinha. <Link href={atualizarEm}>Atualizar agora</Link>
        </p>
      </div>
    </section>
  );
}

export function PlanoEmLeitura({
  clienteId,
  visao,
  tipoDoPlano,
  atualizarEm,
}: {
  readonly clienteId: string;
  readonly visao: VisaoDoPlano;
  readonly tipoDoPlano: string;
  readonly atualizarEm: string;
}) {
  const versao = visao.versao;
  const edicao = visao.acoes.find((acao) => acao.chave === 'editar_secao');
  return (
    <div className="pilha">
      {versao && visao.rotuloDoStatus ? (
        <header className="card estrategia-cabecalho">
          <div className="card__body estrategia-cabecalho__corpo">
            <span className={`pill ${visao.classe}`}>
              {visao.icone ? <Icone nome={visao.icone} tamanho={14} /> : null}
              {visao.rotuloDoStatus}
            </span>
            <span className="estrategia-cabecalho__fato">Plano de {tipoDoPlano}</span>
            <span className="estrategia-cabecalho__fato">Versão {versao.numero}</span>
            <span className="estrategia-cabecalho__fato regra__origem">
              <Icone nome={versao.autor.tipo === 'agente' ? 'agente' : 'pessoa'} tamanho={14} />
              {versao.autor.rotulo}
            </span>
            <time className="estrategia-cabecalho__fato" dateTime={versao.em.toISOString()}>
              {versao.emTexto}
            </time>
          </div>
        </header>
      ) : null}
      <Avisos avisos={visao.avisos} />
      <Execucao visao={visao} atualizarEm={atualizarEm} />
      <AcoesDoPlano clienteId={clienteId} visao={visao} />
      {visao.secoes.length > 0 ? (
        <nav className="estrategia-indice" aria-label="Seções do plano">
          <ul>
            {visao.secoes.map((secao) => (
              <li key={secao.chave}>
                <a href={`#plano-${secao.chave}`}>{secao.titulo}</a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {visao.secoes.map((secao) => (
        <section key={secao.chave} id={`plano-${secao.chave}`} className="card estrategia-secao" aria-labelledby={`titulo-${secao.chave}`}>
          <div className="card__head">
            <h3 className="card__title" id={`titulo-${secao.chave}`}>
              {secao.titulo}
            </h3>
            {edicao && visao.planoId ? (
              <div className="estrategia-secao__acao">
                <EditorDeSecao
                  clienteId={clienteId}
                  planoId={visao.planoId}
                  versaoId={visao.versao?.id ?? ''}
                  secao={secao.chave}
                  titulo={secao.titulo}
                  json={secao.json}
                  habilitada={edicao.habilitada}
                  motivo={edicao.motivos[0] ?? null}
                />
              </div>
            ) : null}
          </div>
          <div className="card__body">
            {secao.blocos.length === 0 ? <p className="subtle">Nada informado nesta seção.</p> : secao.blocos.map((bloco, indice) => <Bloco key={indice} bloco={bloco} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
