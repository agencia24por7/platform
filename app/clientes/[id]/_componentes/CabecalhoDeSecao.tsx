import type { ReactNode } from 'react';

type Props = {
  readonly titulo: string;
  readonly descricao?: ReactNode;
  readonly acao?: ReactNode;
  readonly id?: string;
};

export function CabecalhoDeSecao({ titulo, descricao, acao, id }: Props) {
  return (
    <div className="secao-topo">
      <div className="secao-topo__textos">
        <h2 className="secao-topo__titulo" id={id}>
          {titulo}
        </h2>
        {descricao ? <p className="secao-topo__descricao">{descricao}</p> : null}
      </div>
      {acao ? <div className="secao-topo__acao">{acao}</div> : null}
    </div>
  );
}
