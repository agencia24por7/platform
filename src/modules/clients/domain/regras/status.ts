export const STATUS = ['proposta', 'vigente', 'superada', 'revogada', 'rejeitada'] as const;
export type Status = (typeof STATUS)[number];

export const STATUS_TERMINAIS = ['superada', 'revogada', 'rejeitada'] as const satisfies readonly Status[];

export function ehStatus(valor: unknown): valor is Status {
  return typeof valor === 'string' && (STATUS as readonly string[]).includes(valor);
}

export function ehTerminal(status: Status): boolean {
  return (STATUS_TERMINAIS as readonly string[]).includes(status);
}
