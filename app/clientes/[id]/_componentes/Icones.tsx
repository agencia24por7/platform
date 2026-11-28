export type NomeDoIcone = 'ok' | 'atencao' | 'reautorizar' | 'vazio' | 'pausada' | 'erro' | 'parcial' | 'nao' | 'bloqueia' | 'orienta' | 'pessoa' | 'agente' | 'cliente' | 'arquivo' | 'editar';

const TRACOS: Record<NomeDoIcone, ReactNodeLike> = {
  ok: (
    <>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M6.6 10.2l2.4 2.4 4.4-4.8" />
    </>
  ),
  atencao: (
    <>
      <path d="M10 3.2l7.2 12.4H2.8L10 3.2z" />
      <path d="M10 8.2v3.4M10 13.6v.2" />
    </>
  ),
  reautorizar: (
    <>
      <path d="M16.2 10a6.2 6.2 0 1 1-1.9-4.4" />
      <path d="M16.4 3.6v3.6h-3.6" />
    </>
  ),
  vazio: <circle cx="10" cy="10" r="7.2" strokeDasharray="2.6 2.6" />,
  pausada: (
    <>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M8.2 7.4v5.2M11.8 7.4v5.2" />
    </>
  ),
  erro: (
    <>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M7.6 7.6l4.8 4.8M12.4 7.6l-4.8 4.8" />
    </>
  ),
  parcial: (
    <>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M10 2.8v14.4a7.2 7.2 0 0 0 0-14.4z" fill="currentColor" />
    </>
  ),
  nao: (
    <>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M6.8 10h6.4" />
    </>
  ),
  bloqueia: (
    <>
      <rect x="4.6" y="9" width="10.8" height="7.4" rx="1.6" />
      <path d="M7 9V6.8a3 3 0 0 1 6 0V9" />
    </>
  ),
  orienta: (
    <>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M10 9v4.6M10 6.4v.2" />
    </>
  ),
  pessoa: (
    <>
      <circle cx="10" cy="7" r="3" />
      <path d="M4.2 16.4a5.8 5.8 0 0 1 11.6 0" />
    </>
  ),
  agente: (
    <>
      <rect x="4" y="6.4" width="12" height="9" rx="2.4" />
      <path d="M10 6.4V3.6M7.6 10.6v.4M12.4 10.6v.4" />
    </>
  ),
  cliente: (
    <>
      <path d="M3.4 9L10 3.6 16.6 9" />
      <path d="M5 8.4v8h10v-8" />
    </>
  ),
  arquivo: (
    <>
      <rect x="3" y="3.8" width="14" height="3.6" rx="1" />
      <path d="M4.4 7.4v7.8a1 1 0 0 0 1 1h9.2a1 1 0 0 0 1-1V7.4M8.2 10.6h3.6" />
    </>
  ),
  editar: (
    <>
      <path d="M12.6 4.2l3.2 3.2-8.6 8.6H4v-3.2l8.6-8.6z" />
      <path d="M11 5.8l3.2 3.2" />
    </>
  ),
};

type ReactNodeLike = import('react').ReactNode;

export function Icone({ nome, tamanho = 16 }: { readonly nome: NomeDoIcone; readonly tamanho?: number }) {
  return (
    <svg
      className="icone-estado"
      width={tamanho}
      height={tamanho}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {TRACOS[nome]}
    </svg>
  );
}
