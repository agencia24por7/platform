import { normalizeEmail } from './user.ts';

export function listaDeOperadores(bruta: string | undefined): readonly string[] {
  if (!bruta) return [];
  return bruta
    .split(',')
    .map((item) => normalizeEmail(item))
    .filter((item) => item.length > 0);
}

export function eOperadorDaPlataforma(
  usuario: { readonly email: string; readonly emailVerificado: boolean },
  listaBruta: string | undefined,
): boolean {
  if (!usuario.emailVerificado) return false;
  return listaDeOperadores(listaBruta).includes(normalizeEmail(usuario.email));
}
