export const CATEGORIAS = [
  'investimento',
  'eficiencia',
  'publico',
  'etica_marca',
  'segmento',
  'governanca',
  'processo',
] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const CATEGORIAS_DE_LIMITE = ['investimento', 'eficiencia'] as const satisfies readonly Categoria[];
export type CategoriaDeLimite = (typeof CATEGORIAS_DE_LIMITE)[number];

export const CATEGORIA_ABERTA_A_AGENTES = 'processo' as const satisfies Categoria;

export function ehCategoria(valor: unknown): valor is Categoria {
  return typeof valor === 'string' && (CATEGORIAS as readonly string[]).includes(valor);
}

export function ehCategoriaDeLimite(categoria: Categoria): categoria is CategoriaDeLimite {
  return (CATEGORIAS_DE_LIMITE as readonly string[]).includes(categoria);
}
