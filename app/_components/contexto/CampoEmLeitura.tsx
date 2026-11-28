import type { ReactNode } from 'react';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';

type Props = {
  readonly chave: string;
  readonly rotulo: string;
  readonly essencial: boolean;
  readonly texto: string;
  readonly selos?: ReactNode;
  readonly aoEditar: (() => void) | null;
};

export function CampoEmLeitura({ chave, rotulo, essencial, texto, selos, aoEditar }: Props) {
  return (
    <div className="campo campo--leitura" data-campo={chave}>
      <div className="campo__cabeca">
        <span className="campo__rotulo">
          {rotulo}
          {essencial ? (
            <span className="campo__essencial" title="Essencial">
              essencial
            </span>
          ) : null}
        </span>
        {selos}
        {aoEditar ? (
          <button type="button" className="campo__editar" onClick={aoEditar} aria-label={`Editar ${rotulo}`} title="Editar">
            <Icone nome="editar" tamanho={16} />
          </button>
        ) : null}
      </div>
      <p className="campo__valor">{texto}</p>
    </div>
  );
}
