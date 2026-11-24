export const MEDIDAS = ['gasto', 'custo_por_aquisicao', 'custo_por_lead', 'retorno'] as const;
export type Medida = (typeof MEDIDAS)[number];

export function ehMedida(valor: unknown): valor is Medida {
  return typeof valor === 'string' && (MEDIDAS as readonly string[]).includes(valor);
}
