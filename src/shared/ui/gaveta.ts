export type AlvoDoClique = { closest?(seletor: string): unknown } | null;

export function deveFecharAGaveta(alvo: unknown, gaveta: unknown): boolean {
  if (!alvo || !gaveta) return false;
  if (alvo === gaveta) return true;
  const elemento = alvo as AlvoDoClique;
  return typeof elemento?.closest === 'function' && Boolean(elemento.closest('a[href]'));
}
