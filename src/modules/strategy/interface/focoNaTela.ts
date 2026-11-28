import type { FocoDoPlano } from '../domain/plano.ts';

export const ROTULO_DO_FOCO_DE_MARCA = 'Campanha de marca';
const PRODUTOS_NO_RESUMO = 3;

export function textoDoFoco(foco: FocoDoPlano | null | undefined, maximo: number = PRODUTOS_NO_RESUMO): string | null {
  if (foco === null || foco === undefined) return null;
  if (foco.tipo === 'marca') return ROTULO_DO_FOCO_DE_MARCA;
  const rotulos = foco.produtos.map((produto) => produto.rotulo);
  const visiveis = rotulos.slice(0, maximo).join(', ');
  const resto = rotulos.length - maximo;
  return resto > 0 ? `${visiveis} e mais ${resto}` : visiveis;
}

export function textoDoFocoCompleto(foco: FocoDoPlano | null | undefined): string | null {
  return textoDoFoco(foco, Number.MAX_SAFE_INTEGER);
}
