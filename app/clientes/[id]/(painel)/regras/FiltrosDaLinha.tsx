'use client';

import type { ReactNode } from 'react';

type Props = {
  readonly action: string;
  readonly rotulo: string;
  readonly children: ReactNode;
};

export function FiltrosDaLinha({ action, rotulo, children }: Props) {
  return (
    <form className="regras-filtros" method="get" action={action} aria-label={rotulo} onChange={(evento) => evento.currentTarget.requestSubmit()}>
      {children}
    </form>
  );
}
