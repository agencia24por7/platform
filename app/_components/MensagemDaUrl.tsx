'use client';

import { useEffect, useRef } from 'react';
import { IconeAlerta, IconeCheck } from '@/../app/_components/Icones';

type Props = { readonly erro?: string; readonly feito?: string; readonly n?: string };

function limparMensagemDaUrl() {
  const url = new URL(window.location.href);
  const marcadores = ['erro', 'feito', 'n'];
  if (!marcadores.some((nome) => url.searchParams.has(nome))) return;
  for (const nome of marcadores) url.searchParams.delete(nome);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function MensagemDaUrl({ erro, feito, n }: Props) {
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    limparMensagemDaUrl();
    caixa.current?.focus({ preventScroll: false });
  }, [erro, feito, n]);

  if (!erro && !feito) return null;

  return (
    <div key={n} ref={caixa} tabIndex={-1} className="mensagem-da-url">
      {erro ? (
        <div className="alert alert--error" role="alert">
          <IconeAlerta className="alert__icone" />
          <span>{erro}</span>
        </div>
      ) : null}
      {feito ? (
        <div className="alert alert--ok" role="status">
          <IconeCheck className="alert__icone" />
          <span>{feito}</span>
        </div>
      ) : null}
    </div>
  );
}
