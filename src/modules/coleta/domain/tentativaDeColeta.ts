export const MAXIMO_DE_TENTATIVAS_POR_CHAVE = 50;
const TAMANHO_MAXIMO_DA_CHAVE = 160;

export function chaveDaTentativa(chave: string, tentativa: number): string {
  if (tentativa <= 1) return chave;
  const sufixo = `#${tentativa}`;
  return `${chave.slice(0, TAMANHO_MAXIMO_DA_CHAVE - sufixo.length)}${sufixo}`;
}

export type AberturaResolvida<C> =
  | { readonly tipo: 'existente'; readonly coleta: C }
  | { readonly tipo: 'nova'; readonly chave: string }
  | { readonly tipo: 'esgotada' };

export async function resolverAbertura<C extends { readonly status: string }>(
  chave: string,
  buscar: (chave: string) => Promise<C | null>,
): Promise<AberturaResolvida<C>> {
  for (let tentativa = 1; tentativa <= MAXIMO_DE_TENTATIVAS_POR_CHAVE; tentativa += 1) {
    const candidata = chaveDaTentativa(chave, tentativa);
    const coleta = await buscar(candidata);
    if (!coleta) return { tipo: 'nova', chave: candidata };
    if (coleta.status === 'running') return { tipo: 'existente', coleta };
  }
  return { tipo: 'esgotada' };
}
