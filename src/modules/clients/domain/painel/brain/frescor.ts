import type { Frescor } from './tipos.ts';

const HORA = 3_600_000;

export function frescorPelaColeta(ultima: Date | null, agora: Date): Frescor {
  if (!ultima) return 'desconhecido';
  const horas = (agora.getTime() - ultima.getTime()) / HORA;
  if (horas <= 36) return 'fresco';
  if (horas <= 24 * 7) return 'atrasado';
  return 'parado';
}
