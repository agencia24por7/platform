import type { ReactNode } from 'react';

type Props = {
  readonly titulo: string;
  readonly texto?: ReactNode;
  readonly acao?: ReactNode;
};

export function EstadoVazio({ titulo, texto, acao }: Props) {
  return (
    <div className="estado-vazio">
      <p className="estado-vazio__titulo">{titulo}</p>
      {texto ? <p className="estado-vazio__texto">{texto}</p> : null}
      {acao ? <div className="estado-vazio__acao">{acao}</div> : null}
    </div>
  );
}
