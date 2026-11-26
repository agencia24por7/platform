import { z } from 'zod';
import { PADRAO_DO_TIPO, lerUrn } from '../../brain/domain/urn.ts';
import { esquemaData } from './datas.ts';

export const NOTAS_DE_EVIDENCIA = ['A', 'B', 'C', 'D'] as const;
export type NotaDeEvidencia = (typeof NOTAS_DE_EVIDENCIA)[number];

export const CATEGORIAS_DE_EVIDENCIA = ['lente', 'pratica', 'regra_legal', 'benchmark'] as const;
export type CategoriaDeEvidencia = (typeof CATEGORIAS_DE_EVIDENCIA)[number];

export const MAXIMO_DE_ENTRADAS_NO_PACOTE = 2000;
export const MAXIMO_DE_ENTRADAS_LIDAS_DO_BRAIN = 600;
export const MAXIMO_DE_BYTES_DO_PACOTE_LIDO = 300_000;

export const esquemaEvidenciaDaEntrada = z.strictObject({
  nota: z.enum(NOTAS_DE_EVIDENCIA),
  validoAte: esquemaData.optional(),
  jurisdicao: z.string().min(1).max(40).optional(),
  verificadoEm: esquemaData.optional(),
  obrigatoria: z.boolean().optional(),
  categoria: z.enum(CATEGORIAS_DE_EVIDENCIA),
});
export type EvidenciaDaEntrada = z.infer<typeof esquemaEvidenciaDaEntrada>;

export const esquemaEntradaDoPacote = z.strictObject({
  urn: z.string().max(320).refine((valor) => lerUrn(valor) !== null, 'URN inválida.'),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  tipo: z.string().regex(PADRAO_DO_TIPO),
  titulo: z.string().min(1).max(160),
  resumo: z.string().max(600),
  somenteMetadados: z.boolean(),
  evidencia: esquemaEvidenciaDaEntrada.optional(),
});
export type EntradaDoPacote = z.infer<typeof esquemaEntradaDoPacote>;

export const esquemaPacoteDeLeitura = z.strictObject({
  organizacaoId: z.string().uuid(),
  clienteId: z.string().uuid(),
  lidoEm: z.string().datetime({ offset: true }),
  entradas: z.array(esquemaEntradaDoPacote).max(MAXIMO_DE_ENTRADAS_NO_PACOTE),
  omitidasPorTamanho: z.number().int().min(0).optional(),
  descartadasPorFormato: z.number().int().min(0).optional(),
});
export type PacoteDeLeitura = z.infer<typeof esquemaPacoteDeLeitura>;

export type IndicePorUrn = ReadonlyMap<string, EntradaDoPacote>;

export function indicePorUrn(pacote: PacoteDeLeitura): IndicePorUrn {
  return new Map(pacote.entradas.map((entrada) => [entrada.urn, entrada]));
}

export function entradaDoPacote(pacote: PacoteDeLeitura, urn: string): EntradaDoPacote | undefined {
  return pacote.entradas.find((entrada) => entrada.urn === urn);
}

export function hashesDoPacote(pacote: PacoteDeLeitura): ReadonlyMap<string, string> {
  return new Map(pacote.entradas.map((entrada) => [entrada.urn, entrada.hash]));
}

export function entradasDeRegraLegalObrigatoria(pacote: PacoteDeLeitura): EntradaDoPacote[] {
  return pacote.entradas.filter(
    (entrada) => entrada.evidencia?.categoria === 'regra_legal' && entrada.evidencia.obrigatoria === true,
  );
}
