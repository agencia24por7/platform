export const NATUREZAS = ['limite', 'regra', 'decisao'] as const;
export type Natureza = (typeof NATUREZAS)[number];

export const NATUREZAS_NORMATIVAS = ['limite', 'regra'] as const satisfies readonly Natureza[];

export function ehNatureza(valor: unknown): valor is Natureza {
  return typeof valor === 'string' && (NATUREZAS as readonly string[]).includes(valor);
}

export function ehNormativa(natureza: Natureza): boolean {
  return natureza === 'limite' || natureza === 'regra';
}
