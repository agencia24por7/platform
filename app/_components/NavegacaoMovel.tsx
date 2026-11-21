'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { deveFecharAGaveta } from '@/shared/ui/gaveta';

export function NavegacaoMovel({ children }: { readonly children: ReactNode }) {
  const gaveta = useRef<HTMLDialogElement>(null);
  const [aberta, setAberta] = useState(false);
  const caminho = usePathname();

  useEffect(() => {
    gaveta.current?.close();
  }, [caminho]);

  function abrir() {
    gaveta.current?.showModal();
    setAberta(true);
  }

  function fecharNoVeuOuNoLink(evento: MouseEvent<HTMLDialogElement>) {
    if (deveFecharAGaveta(evento.target, gaveta.current)) gaveta.current?.close();
  }

  return (
    <>
      <button
        type="button"
        className="menu-botao"
        aria-label="Abrir menu de navegação"
        aria-haspopup="dialog"
        aria-expanded={aberta}
        aria-controls="gaveta-de-navegacao"
        onClick={abrir}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </button>
      <dialog
        id="gaveta-de-navegacao"
        ref={gaveta}
        className="gaveta"
        aria-label="Navegação"
        onClose={() => setAberta(false)}
        onClick={fecharNoVeuOuNoLink}
      >
        <div className="gaveta__topo">
          <img className="side__logo" src="/orla/logo.png" alt="orla" />
          <button
            type="button"
            className="menu-botao gaveta__fechar"
            aria-label="Fechar menu"
            onClick={() => gaveta.current?.close()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </dialog>
    </>
  );
}
