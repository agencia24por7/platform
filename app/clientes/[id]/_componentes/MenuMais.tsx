'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export function MenuMais({ rotulo, children, textoDoGatilho, compacto = false }: { readonly rotulo: string; readonly children: ReactNode; readonly textoDoGatilho?: string; readonly compacto?: boolean }) {
  const detalhes = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function aoPressionar(evento: KeyboardEvent) {
      const aberto = detalhes.current;
      if (evento.key !== 'Escape' || !aberto?.open) return;
      aberto.open = false;
      aberto.querySelector('summary')?.focus();
    }
    function aoClicar(evento: MouseEvent) {
      const aberto = detalhes.current;
      if (aberto?.open && evento.target instanceof Node && !aberto.contains(evento.target)) aberto.open = false;
    }
    document.addEventListener('keydown', aoPressionar);
    document.addEventListener('click', aoClicar);
    return () => {
      document.removeEventListener('keydown', aoPressionar);
      document.removeEventListener('click', aoClicar);
    };
  }, []);

  return (
    <details className={`menu-mais${compacto ? " menu-mais--compacto" : ""}`} ref={detalhes}>
      <summary className={textoDoGatilho ? 'btn btn--compacto' : 'btn btn--icone menu-mais__gatilho'} aria-label={rotulo} title={rotulo}>
        {textoDoGatilho ?? (
          <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false">
            <circle cx="4.5" cy="10" r="1.6" />
            <circle cx="10" cy="10" r="1.6" />
            <circle cx="15.5" cy="10" r="1.6" />
          </svg>
        )}
      </summary>
      <div className="menu-mais__painel">{children}</div>
    </details>
  );
}
