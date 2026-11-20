export type LinhaDaFonte = Readonly<Record<string, unknown>>;

export const ROTULO_MAXIMO = 200;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function texto(valor: unknown, maximo: number = ROTULO_MAXIMO): string | null {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const limpo = String(valor).trim();
  return limpo ? limpo.slice(0, maximo) : null;
}

export function identificador(valor: unknown): string | null {
  const id = texto(valor);
  return id && /^[A-Za-z0-9_.:-]+$/.test(id) ? id : null;
}

export function enumeracao(valor: unknown): string | null {
  return typeof valor === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(valor) ? valor : null;
}

export function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : null;
}

export function inteiro(valor: unknown): number | null {
  const convertido = numero(valor);
  return convertido === null ? null : Math.trunc(convertido);
}

export function contagem(valor: unknown): number | null {
  const convertido = inteiro(valor);
  return convertido !== null && convertido >= 0 ? convertido : null;
}

export function booleano(valor: unknown): boolean | null {
  return typeof valor === 'boolean' ? valor : null;
}

export function instante(valor: unknown): string | null {
  if (typeof valor !== 'string' || !valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

export function dataIso(valor: unknown): string | null {
  return typeof valor === 'string' && DATA_ISO.test(valor) ? valor : null;
}

export function chaveUnica<T>(itens: readonly T[], chaveDe: (item: T) => string): readonly T[] {
  const porChave = new Map<string, T>();
  for (const item of itens) porChave.set(chaveDe(item), item);
  return [...porChave.values()];
}

export function aplicar<T>(linhas: readonly LinhaDaFonte[], converter: (linha: LinhaDaFonte) => T | null): readonly T[] {
  const convertidas: T[] = [];
  for (const linha of linhas) {
    const convertida = converter(linha);
    if (convertida !== null) convertidas.push(convertida);
  }
  return convertidas;
}
