export const ORIGENS = ['cliente', 'agencia', 'agente'] as const;
export type Origem = (typeof ORIGENS)[number];

export function ehOrigem(valor: unknown): valor is Origem {
  return typeof valor === 'string' && (ORIGENS as readonly string[]).includes(valor);
}
