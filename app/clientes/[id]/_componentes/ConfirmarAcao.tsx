'use client';

import { useId, useRef, type ReactNode } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';

type Props = {
  readonly gatilho: string;
  readonly rotuloDoGatilho?: string;
  readonly titulo: string;
  readonly descricao: ReactNode;
  readonly confirmar: string;
  readonly pendente?: string;
  readonly action: (dados: FormData) => void | Promise<void>;
  readonly children?: ReactNode;
  readonly gatilhoClasse?: string;
};

export function ConfirmarAcao({ gatilho, rotuloDoGatilho, titulo, descricao, confirmar, pendente = 'Enviando…', action, children, gatilhoClasse = 'btn btn--compacto btn--perigo' }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const idDescricao = useId();

  return (
    <>
      <button type="button" className={gatilhoClasse} aria-label={rotuloDoGatilho} onClick={() => dialogo.current?.showModal()}>
        {gatilho}
      </button>
      <dialog
        ref={dialogo}
        className="confirmar"
        aria-labelledby={idTitulo}
        aria-describedby={idDescricao}
        onClick={(evento) => {
          if (evento.target === evento.currentTarget) evento.currentTarget.close();
        }}
      >
        <form
          action={action}
          className="confirmar__corpo"
          onSubmit={() => {
            setTimeout(() => dialogo.current?.close(), 0);
          }}
        >
          {children}
          <h2 className="confirmar__titulo" id={idTitulo}>
            {titulo}
          </h2>
          <div className="confirmar__descricao" id={idDescricao}>
            {descricao}
          </div>
          <div className="confirmar__acoes">
            <button type="button" className="btn" autoFocus onClick={() => dialogo.current?.close()}>
              Cancelar
            </button>
            <BotaoDeEnvio className="btn btn--perigo-solido" pendente={pendente}>
              {confirmar}
            </BotaoDeEnvio>
          </div>
        </form>
      </dialog>
    </>
  );
}
