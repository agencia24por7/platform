import Link from 'next/link';
import type { ReactNode } from 'react';
import { Indicador } from '@/../app/clientes/[id]/_componentes/Indicador';
import type { ProntidaoDoCabecalho, VisaoDoCabecalho } from '@/modules/clients/domain/painel/cabecalho';

function Prontidao({ prontidao }: { readonly prontidao: ProntidaoDoCabecalho }) {
  const marcador = <Indicador tom={prontidao.tom} rotulo={prontidao.rotulo} icone={prontidao.icone} />;
  if (!prontidao.contagem) {
    return (
      <div className="cliente-topo__prontidao">
        <span className="cliente-topo__rotulo">Pronto para planejar</span>
        {marcador}
      </div>
    );
  }
  return (
    <details className="cliente-topo__prontidao cliente-topo__prontidao--recolhivel">
      <summary className="cliente-topo__prontidao-resumo">
        <span className="cliente-topo__rotulo">Pronto para planejar</span>
        {marcador}
        <span className="cliente-topo__sugestoes">{prontidao.contagem}</span>
      </summary>
      <ul className="prontidao__lacunas" aria-label="O que falta">
        {prontidao.lacunas.map((lacuna) => (
          <li key={lacuna.chave}>{lacuna.titulo}</li>
        ))}
        {prontidao.lacunasDeRegras.map((lacuna) => (
          <li key={lacuna.chave}>
            <span>{lacuna.nome}</span>
            {lacuna.href ? (
              <Link className="btn btn--compacto" href={lacuna.href}>
                Definir
              </Link>
            ) : (
              <span className="subtle xsmall">Peça a quem administra</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

type Props = {
  readonly visao: VisaoDoCabecalho;
  readonly migalhas: { readonly rotulo: string; readonly href: string };
  readonly rotuloDoResumo: string;
  readonly acoes: ReactNode;
  readonly aviso: ReactNode;
};

export function CabecalhoDoCliente({ visao, migalhas, rotuloDoResumo, acoes, aviso }: Props) {
  return (
    <header className="cliente-topo">
      <nav className="migalhas" aria-label="Você está em">
        <Link href={migalhas.href}>{migalhas.rotulo}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{visao.nome}</span>
      </nav>
      <div className="cliente-topo__linha">
        <div className="cliente-topo__quem">
          {visao.logo ? (
            <img className="cliente-topo__logo" src={visao.logo} alt={`Logo de ${visao.nome}`} width={56} height={56} decoding="async" />
          ) : (
            <span className="cliente-topo__monograma" aria-hidden="true">
              {visao.inicial}
            </span>
          )}
          <div className="cliente-topo__textos">
            <h1 className="page__title cliente-topo__nome">{visao.nome}</h1>
            <p className="page__sub cliente-topo__fatos">{visao.fatos.join(' · ')}</p>
          </div>
        </div>
        <div className="cliente-topo__direita">{acoes}</div>
      </div>
      <div className="cliente-topo__meta" role="group" aria-label={rotuloDoResumo}>
        <div className="cliente-topo__item">
          <span className="cliente-topo__rotulo">Situação</span>
          <Indicador tom={visao.situacao.tom} rotulo={visao.situacao.rotulo} />
        </div>
        {visao.prontidao ? <Prontidao prontidao={visao.prontidao} /> : null}
        {visao.pedirLogo ? (
          <Link className="cliente-topo__pedir-logo quiet-link" href={visao.pedirLogo}>
            Adicionar logo
          </Link>
        ) : null}
      </div>
      {aviso}
    </header>
  );
}
