import { z } from 'zod';

const FORMATO_DE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export function dataIsoValida(texto: string): boolean {
  if (!FORMATO_DE_DATA.test(texto)) return false;
  const data = new Date(`${texto}T00:00:00.000Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(texto);
}

export const esquemaData = z.string().refine(dataIsoValida, 'Data ISO YYYY-MM-DD válida.');

export function venceu(validoAte: string | undefined, hoje: string): boolean {
  return validoAte !== undefined && validoAte < hoje;
}
