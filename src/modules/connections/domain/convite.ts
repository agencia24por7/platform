export type ConviteRecusado =
  | 'formato'
  | 'igual_a_administradora'
  | 'ja_alcancada'
  | 'sem_administradora';

export type ConviteDecidido =
  | { readonly ok: true; readonly alvo: string }
  | { readonly ok: false; readonly motivo: ConviteRecusado };

const SOMENTE_DIGITOS = /\D/g;

export function normalizarCustomerId(bruto: string): string | null {
  const digitos = bruto.replace(SOMENTE_DIGITOS, '');
  if (digitos.length !== 10) return null;

  return `${digitos.slice(0, 3)}-${digitos.slice(3, 6)}-${digitos.slice(6)}`;
}

export function decidirConvite(input: {
  readonly bruto: string;
  readonly administradora: string | null;
  readonly jaAlcancadas: readonly string[];
}): ConviteDecidido {
  if (!input.administradora) return { ok: false, motivo: 'sem_administradora' };

  const alvo = normalizarCustomerId(input.bruto);
  if (!alvo) return { ok: false, motivo: 'formato' };

  if (alvo === input.administradora) return { ok: false, motivo: 'igual_a_administradora' };
  if (input.jaAlcancadas.includes(alvo)) return { ok: false, motivo: 'ja_alcancada' };

  return { ok: true, alvo };
}

export const MOTIVO_DO_CONVITE: Record<ConviteRecusado, string> = {
  formato: 'O identificador precisa ter 10 dígitos, no formato 123-456-7890.',
  igual_a_administradora: 'Essa é a própria administradora. Informe a conta que você quer convidar.',
  ja_alcancada: 'Esta conta já é alcançada por esta autorização.',
  sem_administradora: 'Esta autorização não passa por uma administradora, então não há para onde convidar.',
};
