'use client';

import { useState } from 'react';

export function CopyButton({
  texto,
  rotulo = 'Copiar link',
  className = 'btn btn--compacto',
}: {
  readonly texto: string;
  readonly rotulo?: string;
  readonly className?: string;
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
    <button type="button" className={className} onClick={copiar} aria-live="polite">
      {copiado ? 'Copiado ✓' : rotulo}
    </button>
  );
}
