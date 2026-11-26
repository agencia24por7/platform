import { z } from 'zod';
import { CentavosSchema, MOEDA, type Valor } from '../../clients/domain/regras/valor.ts';

export const esquemaDinheiro = z.strictObject({ centavos: CentavosSchema, moeda: z.literal(MOEDA) });
export type Dinheiro = z.infer<typeof esquemaDinheiro>;

export function centavosDe(dinheiro: Dinheiro): bigint {
  return BigInt(dinheiro.centavos);
}

export function somaDeCentavos(valores: readonly Dinheiro[]): bigint {
  return valores.reduce((total, valor) => total + centavosDe(valor), 0n);
}

export function comoValor(dinheiro: Dinheiro): Valor {
  return { unidade: 'brl_centavos', centavos: dinheiro.centavos, moeda: MOEDA };
}

export function dinheiroDeCentavos(centavos: bigint): Dinheiro {
  return { centavos: centavos.toString(), moeda: MOEDA };
}
