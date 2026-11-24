export const FORCAS = ['dura', 'orientacao'] as const;
export type Forca = (typeof FORCAS)[number];

export function ehForca(valor: unknown): valor is Forca {
  return typeof valor === 'string' && (FORCAS as readonly string[]).includes(valor);
}
