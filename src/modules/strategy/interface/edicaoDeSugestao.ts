import type { ValorDaSugestao } from '../domain/plano.ts';
import { centavosDeReais } from './formatosDoPlano.ts';

export type EdicaoLida = { readonly valor: ValorDaSugestao } | { readonly valor: null };

export function valorDaEdicao(original: ValorDaSugestao, textoDigitado: string, textoOriginal: string | null): EdicaoLida {
  const texto = textoDigitado.trim();
  if (texto === '' || texto === textoOriginal) return { valor: null };
  if ('texto' in original) return { valor: { texto } };
  if (original.unidade === 'brl_centavos') return { valor: { unidade: 'brl_centavos', centavos: centavosDeReais(texto) ?? texto, moeda: 'BRL' } };
  const decimal = texto.replace(/%$/, '').trim().replace(',', '.');
  return { valor: { unidade: original.unidade, decimal } };
}
