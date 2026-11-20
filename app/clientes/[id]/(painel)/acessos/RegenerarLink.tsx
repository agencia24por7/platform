'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CopyButton } from '@/../app/_components/CopyButton';
import { regenerarLinkDeContexto, type LinkGerado } from '@/../app/clientes/[id]/(painel)/acessos/acoes';

export function RegenerarLink({ clienteId, linkId }: { readonly clienteId: string; readonly linkId: string }) {
  const [resultado, setResultado] = useState<LinkGerado | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  if (resultado?.ok) {
    return (
      <span className="link-novo" role="status">
        <code className="mono">{resultado.url}</code>
        <CopyButton texto={resultado.url} />
        <button type="button" className="btn btn--compacto" onClick={() => { setResultado(null); router.refresh(); }}>
          Ok
        </button>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn btn--compacto"
        disabled={pendente}
        aria-busy={pendente}
        title="Revoga este endereço e gera outro com as mesmas seções e prazo"
        onClick={() => iniciar(async () => setResultado(await regenerarLinkDeContexto(clienteId, linkId)))}
      >
        {pendente ? 'Gerando…' : 'Gerar novo endereço'}
      </button>
      {resultado && !resultado.ok ? <span className="alert alert--error" role="alert">{resultado.erro}</span> : null}
    </>
  );
}
