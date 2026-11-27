import type { Plataforma } from '../plano.ts';
import { catalogoGoogle } from './google.ts';
import { catalogoMeta } from './meta.ts';
import { esquemaCatalogoDeCampos, type CatalogoDeCampos } from './tipos.ts';

export const CATALOGOS_DISPONIVEIS: readonly CatalogoDeCampos[] = [catalogoMeta, catalogoGoogle].map((catalogo) => esquemaCatalogoDeCampos.parse(catalogo));

export function plataformasComCatalogo(catalogos: readonly CatalogoDeCampos[] = CATALOGOS_DISPONIVEIS): readonly Plataforma[] {
  return catalogos.map((catalogo) => catalogo.plataforma);
}

export function catalogosDasPlataformas(
  plataformas: readonly Plataforma[],
  catalogos: readonly CatalogoDeCampos[] = CATALOGOS_DISPONIVEIS,
): readonly CatalogoDeCampos[] {
  return catalogos.filter((catalogo) => plataformas.includes(catalogo.plataforma));
}
