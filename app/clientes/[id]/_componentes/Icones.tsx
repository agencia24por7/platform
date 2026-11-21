export type NomeDoIcone = 'ok' | 'atencao' | 'reautorizar' | 'vazio' | 'pausada' | 'erro' | 'parcial' | 'nao';

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
