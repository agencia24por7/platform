import type { Completude } from './completude.ts';

export type EssencialDeRegrasFaltando = { readonly chave: string; readonly nome: string };

export type ProntidaoDeRegras = {
  readonly essenciaisFaltando: readonly EssencialDeRegrasFaltando[];
};

export type LacunaDaProntidao =
  | { readonly origem: 'contexto'; readonly secao: string }
  | { readonly origem: 'regras'; readonly chave: string; readonly nome: string };

export type ProntidaoCombinada = {
  readonly pronto: boolean;
  readonly contextoCompleto: boolean;
  readonly regrasCompletas: boolean;
  readonly lacunas: readonly LacunaDaProntidao[];
};

export function combinarProntidao(completude: Completude, regras: ProntidaoDeRegras): ProntidaoCombinada {
  const lacunasDoContexto = completude.secoes
    .filter((secao) => !secao.essenciaisCompletos)
    .map((secao): LacunaDaProntidao => ({ origem: 'contexto', secao: secao.secao }));
  const lacunasDeRegras = regras.essenciaisFaltando.map(
    (falta): LacunaDaProntidao => ({ origem: 'regras', chave: falta.chave, nome: falta.nome }),
  );
  return {
    pronto: lacunasDoContexto.length === 0 && lacunasDeRegras.length === 0,
    contextoCompleto: lacunasDoContexto.length === 0,
    regrasCompletas: lacunasDeRegras.length === 0,
    lacunas: [...lacunasDoContexto, ...lacunasDeRegras],
  };
}
