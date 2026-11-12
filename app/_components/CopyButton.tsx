'use client';

import { useState } from 'react';

export function CopyButton({ texto }: { readonly texto: string }) {
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
    <button type="button" className="btn btn--compacto" onClick={copiar}>
      {copiado ? 'Copiado ✓' : 'Copiar link'}
    </button>
  );
}
