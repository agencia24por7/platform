import { z } from 'zod';
import { err, ok, type Result } from '../../../../shared/result/result.ts';

export const UNIDADES = ['brl_centavos', 'razao', 'percentual'] as const;
export type Unidade = (typeof UNIDADES)[number];

export const MOEDA = 'BRL' as const;

const CENTAVOS = /^\d{1,15}$/;
const DECIMAL = /^\d{1,18}(\.\d{1,8})?$/;

export const CentavosSchema = z.string().regex(CENTAVOS, 'Centavos devem ser inteiros não negativos em texto.');
export const DecimalSchema = z.string().regex(DECIMAL, 'Decimal em texto, com ponto e sem sinal.');

export const ValorSchema = z.discriminatedUnion('unidade', [
  z.object({ unidade: z.literal('brl_centavos'), centavos: CentavosSchema, moeda: z.literal(MOEDA) }).strict(),
  z.object({ unidade: z.literal('razao'), decimal: DecimalSchema }).strict(),
  z.object({ unidade: z.literal('percentual'), decimal: DecimalSchema }).strict(),
]);
export type Valor = z.infer<typeof ValorSchema>;

export type ErroDeValor = { readonly codigo: 'centavos_invalidos' | 'decimal_invalido' | 'unidades_diferentes'; readonly mensagem: string };

export function valorEmCentavos(centavos: number | string | bigint): Result<Valor, ErroDeValor> {
  let texto: string;
  if (typeof centavos === 'number') {
    if (!Number.isSafeInteger(centavos) || centavos < 0) {
      return err({ codigo: 'centavos_invalidos', mensagem: 'Centavos devem ser inteiro seguro não negativo.' });
    }
    texto = String(centavos);
  } else {
    texto = String(centavos);
  }
  if (!CENTAVOS.test(texto)) {
    return err({ codigo: 'centavos_invalidos', mensagem: 'Centavos devem ser inteiros não negativos.' });
  }
  return ok({ unidade: 'brl_centavos', centavos: texto, moeda: MOEDA });
}

export function valorDecimal(unidade: 'razao' | 'percentual', decimal: string): Result<Valor, ErroDeValor> {
  if (!DECIMAL.test(decimal)) {
    return err({ codigo: 'decimal_invalido', mensagem: 'Decimal inválido.' });
  }
  return ok({ unidade, decimal });
}

type Decimal = { readonly inteiro: bigint; readonly escala: number };

export function ehDecimalTexto(texto: string): boolean {
  return DECIMAL.test(texto);
}

function lerDecimal(texto: string): Decimal {
  const [parteInteira = '0', parteFracionaria = ''] = texto.split('.');
  return { inteiro: BigInt(parteInteira + parteFracionaria), escala: parteFracionaria.length };
}

export function compararDecimais(a: string, b: string): -1 | 0 | 1 {
  const x = lerDecimal(a);
  const y = lerDecimal(b);
  const escala = Math.max(x.escala, y.escala);
  const xa = x.inteiro * 10n ** BigInt(escala - x.escala);
  const ya = y.inteiro * 10n ** BigInt(escala - y.escala);
  if (xa === ya) return 0;
  return xa < ya ? -1 : 1;
}

function magnitude(valor: Valor): string {
  return valor.unidade === 'brl_centavos' ? valor.centavos : valor.decimal;
}

export function compararValores(a: Valor, b: Valor): Result<-1 | 0 | 1, ErroDeValor> {
  if (a.unidade !== b.unidade) {
    return err({ codigo: 'unidades_diferentes', mensagem: 'Valores de unidades diferentes não se comparam.' });
  }
  return ok(compararDecimais(magnitude(a), magnitude(b)));
}

export function valoresIguais(a: Valor, b: Valor): boolean {
  const comparacao = compararValores(a, b);
  return comparacao.ok && comparacao.value === 0;
}

function agruparMilhares(inteiro: string): string {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatarCentavos(centavos: string): string {
  const completo = BigInt(centavos).toString().padStart(3, '0');
  const reais = completo.slice(0, -2);
  return `R$ ${agruparMilhares(reais)},${completo.slice(-2)}`;
}

function formatarDecimal(decimal: string): string {
  const [parteInteira = '0', parteFracionaria] = decimal.split('.');
  const inteiro = BigInt(parteInteira).toString();
  return parteFracionaria === undefined ? agruparMilhares(inteiro) : `${agruparMilhares(inteiro)},${parteFracionaria}`;
}

export function formatarValor(valor: Valor): string {
  if (valor.unidade === 'brl_centavos') return formatarCentavos(valor.centavos);
  if (valor.unidade === 'percentual') return `${formatarDecimal(valor.decimal)}%`;
  return `${formatarDecimal(valor.decimal)}x`;
}
