import type { EntradaDoCatalogo } from './entrada.ts';

export type FiltrosDoCatalogo = {
  readonly tipo?: string | undefined;
  readonly tag?: string | undefined;
  readonly provedor?: string | undefined;
  readonly plataforma?: string | undefined;
  readonly sensibilidade?: string | undefined;
  readonly q?: string | undefined;
};

export type PaginaDoCatalogo = {
  readonly entradas: readonly EntradaDoCatalogo[];
  readonly total: number;
  readonly proximoCursor: string | null;
};

function normalizar(texto: string): string {
  return texto.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
}

export function filtrarCatalogo(entradas: readonly EntradaDoCatalogo[], filtros: FiltrosDoCatalogo): readonly EntradaDoCatalogo[] {
  const termo = filtros.q ? normalizar(filtros.q) : null;
  return entradas.filter((entrada) => {
    if (filtros.tipo && entrada.tipo !== filtros.tipo) return false;
    if (filtros.tag && !entrada.tags.includes(filtros.tag)) return false;
    if (filtros.provedor && entrada.provedor !== filtros.provedor) return false;
    if (filtros.sensibilidade && entrada.sensibilidade.nivel !== filtros.sensibilidade) return false;
    if (filtros.plataforma && entrada.plataforma !== filtros.plataforma && !entrada.tags.includes(`plataforma:${filtros.plataforma}`)) {
      return false;
    }
    if (termo && !normalizar(`${entrada.titulo}\n${entrada.descricao}`).includes(termo)) return false;
    return true;
  });
}

export function codificarCursor(urn: string): string {
  return Buffer.from(urn, 'utf8').toString('base64url');
}

export function decodificarCursor(cursor: string): string | null {
  try {
    const urn = Buffer.from(cursor, 'base64url').toString('utf8');
    return urn.startsWith('orla:') ? urn : null;
  } catch {
    return null;
  }
}

export function paginar(entradas: readonly EntradaDoCatalogo[], limite: number, cursor: string | null): PaginaDoCatalogo {
  const ordenadas = [...entradas].sort((a, b) => a.urn.localeCompare(b.urn));
  const depois = cursor ? decodificarCursor(cursor) : null;
  const restantes = depois ? ordenadas.filter((entrada) => entrada.urn.localeCompare(depois) > 0) : ordenadas;
  const pagina = restantes.slice(0, limite);
  const temMais = restantes.length > limite;
  return {
    entradas: pagina,
    total: ordenadas.length,
    proximoCursor: temMais && pagina.length > 0 ? codificarCursor(pagina[pagina.length - 1]!.urn) : null,
  };
}
