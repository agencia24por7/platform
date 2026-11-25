export const PARAMETROS_DE_AVISO = ['erro', 'feito'] as const;

export const SEGUNDOS_DO_AVISO_DE_SUCESSO = 6;

export function semParametrosDeAviso(endereco: string): string {
  const base = 'http://local.invalid';
  const url = new URL(endereco, base);
  for (const chave of PARAMETROS_DE_AVISO) url.searchParams.delete(chave);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function temParametroDeAviso(busca: string): boolean {
  const parametros = new URLSearchParams(busca);
  return PARAMETROS_DE_AVISO.some((chave) => parametros.has(chave));
}
