import { createHash } from 'node:crypto';

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor instanceof Date) return valor.toISOString();
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(
      Object.keys(valor as Record<string, unknown>)
        .filter((chave) => (valor as Record<string, unknown>)[chave] !== undefined)
        .sort()
        .map((chave) => [chave, ordenar((valor as Record<string, unknown>)[chave])]),
    );
  }
  return valor;
}

export function jsonEstavel(valor: unknown, indentacao?: number): string {
  return JSON.stringify(ordenar(valor), null, indentacao);
}

export function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

export function hashEstavel(valor: unknown): string {
  return sha256(jsonEstavel(valor));
}
