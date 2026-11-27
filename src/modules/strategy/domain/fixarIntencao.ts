import type { Intencao, IntencaoDoPlano, Plano } from './plano.ts';

function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .filter(([, filho]) => filho !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([chave, filho]) => [chave, canonico(filho)]),
    );
  }
  return valor;
}

export function intencoesIguais(a: IntencaoDoPlano, b: IntencaoDoPlano): boolean {
  return JSON.stringify(canonico(a)) === JSON.stringify(canonico(b));
}

export type PlanoComIntencaoFixada = { readonly plano: Plano; readonly alterada: boolean };

export function fixarIntencao(planoDoModelo: Plano, intencaoConfiavel: Intencao): PlanoComIntencaoFixada {
  if (intencoesIguais(planoDoModelo.intencao, intencaoConfiavel)) return { plano: planoDoModelo, alterada: false };
  return { plano: { ...planoDoModelo, intencao: intencaoConfiavel }, alterada: true };
}
