import type { EntradaDoCatalogoAtual, PacoteDeLeitura } from '@/modules/strategy/domain/index';

export type CatalogoAtual = ReadonlyMap<string, EntradaDoCatalogoAtual>;

export function catalogoAtualDoPacote(pacote: PacoteDeLeitura): CatalogoAtual {
  return new Map(
    pacote.entradas.map((e): [string, EntradaDoCatalogoAtual] => [
      e.urn,
      { hash: e.hash, tipo: e.tipo, ...(e.evidencia?.validoAte ? { validoAte: e.evidencia.validoAte } : {}) },
    ]),
  );
}
