export const TIPOS_DE_PLANO = ['aquisicao', 'marca', 'comunidade', 'retencao'] as const;
export type TipoDePlano = (typeof TIPOS_DE_PLANO)[number];

export const ROTULO_DO_TIPO_DE_PLANO: Readonly<Record<TipoDePlano, string>> = {
  aquisicao: 'Aquisição',
  marca: 'Marca',
  comunidade: 'Comunidade',
  retencao: 'Retenção',
};

export function ehTipoDePlano(valor: unknown): valor is TipoDePlano {
  return typeof valor === 'string' && (TIPOS_DE_PLANO as readonly string[]).includes(valor);
}
