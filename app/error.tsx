'use client';

import { useEffect } from 'react';

export default function Erro({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  useEffect(() => {
    fetch('/api/erros', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: error.message, digest: error.digest, stack: error.stack }),
      keepalive: true,
    }).catch(() => {});
  }, [error]);

  return (
    <div className="erro">
      <div className="erro__caixa">
        <img className="erro__icone" src="/orla/icone.png" alt="" width={44} height={44} />
        <h1 className="erro__titulo">Algo deu errado por aqui</h1>
        <p className="erro__texto">
          Isso não devia ter acontecido. Tente de novo — se continuar, avise quem administra a Orla.
        </p>
        <div className="erro__acoes">
          <button className="btn btn--primary" type="button" onClick={reset}>
            Tentar de novo
          </button>
          <a className="btn" href="/">
            Voltar para o início
          </a>
        </div>
        {error.digest ? <p className="erro__codigo">código {error.digest}</p> : null}
      </div>
    </div>
  );
}
