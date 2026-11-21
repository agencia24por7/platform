'use client';

import { useEffect } from 'react';

export function FocoNaConta({ id }: { readonly id: string }) {
  useEffect(() => {
    const alvo = document.getElementById(id);
    alvo?.scrollIntoView({ block: 'center' });
    alvo?.focus();
  }, [id]);
  return null;
}
