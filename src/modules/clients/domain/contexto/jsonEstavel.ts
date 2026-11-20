function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor instanceof Date) return valor.toISOString();
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(
      Object.keys(valor as Record<string, unknown>)
        .sort()
        .filter((chave) => (valor as Record<string, unknown>)[chave] !== undefined)
        .map((chave) => [chave, ordenar((valor as Record<string, unknown>)[chave])]),
    );
  }
  return valor;
}

export function jsonEstavel(valor: unknown, indentacao?: number): string {
  return JSON.stringify(ordenar(valor), null, indentacao);
}

export function iguais(a: unknown, b: unknown): boolean {
  return jsonEstavel(a ?? null) === jsonEstavel(b ?? null);
}
