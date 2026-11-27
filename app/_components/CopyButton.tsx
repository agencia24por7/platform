'use client';

import { useState } from 'react';

export function CopyButton({
  texto,
  rotulo = 'Copiar link',
  className = 'btn btn--compacto',
  autoFoco = false,
}: {
  readonly texto: string;
  readonly rotulo?: string;
  readonly className?: string;
  readonly autoFoco?: boolean;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      return;
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={copiar} autoFocus={autoFoco}>
        {copiado ? 'Copiado ✓' : rotulo}
      </button>
      <span className="so-leitor" role="status">
        {copiado ? 'Copiado para a área de transferência.' : ''}
      </span>
    </>
  );
}
