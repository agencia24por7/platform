'use client';

import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';

export function BuscaDeFontes({ habilitada, children }: { readonly habilitada: boolean; readonly children: ReactNode }) {
  const raiz = useRef<HTMLDivElement>(null);
  const [semResultado, setSemResultado] = useState(false);

  function filtrar(evento: ChangeEvent<HTMLInputElement>) {
    const termo = evento.target.value.trim().toLocaleLowerCase('pt-BR');
    const grupos = raiz.current?.querySelectorAll<HTMLElement>('[data-grupo-fonte]') ?? [];
    let visiveis = 0;
    grupos.forEach((grupo) => {
      let acertos = 0;
      grupo.querySelectorAll<HTMLElement>('[data-fonte-nome]').forEach((linha) => {
        const confere = termo === '' || (linha.dataset.fonteNome ?? '').includes(termo);
        linha.hidden = !confere;
        if (confere) acertos += 1;
      });
      grupo.hidden = acertos === 0;
      if (acertos > 0) visiveis += 1;
      const detalhes = grupo.querySelector('details');
      if (detalhes && termo !== '' && acertos > 0) detalhes.open = true;
    });
    setSemResultado(termo !== '' && visiveis === 0);
  }

  if (!habilitada) return <>{children}</>;

  return (
    <div className="busca-fontes" ref={raiz}>
      <input className="input" type="search" placeholder="Buscar conta ou fonte pelo nome" aria-label="Buscar conta ou fonte pelo nome" onChange={filtrar} />
      {children}
      {semResultado ? (
        <p className="subtle small busca-fontes__vazio" role="status">
          Nenhuma conta ou fonte com esse nome.
        </p>
      ) : null}
    </div>
  );
}
