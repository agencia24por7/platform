'use client';

import { TilIcone } from '@/../app/_components/Til';

export function ThemeToggle() {
  function alternar() {
    const raiz = document.documentElement;
    const atual =
      raiz.getAttribute('data-tema') ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'grafite' : 'claro');
    const proximo = atual === 'grafite' ? 'claro' : 'grafite';
    raiz.setAttribute('data-tema', proximo);
    try {
      localStorage.setItem('orla-tema', proximo);
    } catch {
      return;
    }
  }

  return (
    <button type="button" className="tema-botao" onClick={alternar} aria-label="Alternar entre o tema claro e o grafite">
      <TilIcone className="til--claro" />
      <TilIcone className="til--escuro" />
    </button>
  );
}
