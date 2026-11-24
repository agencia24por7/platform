import { z } from 'zod';
import {
  CATEGORIAS,
  ChaveSchema,
  EscopoSchema,
  FORCAS,
  LIMITES_DE_TAMANHO,
  NATUREZAS,
  ORIGENS,
  STATUS,
  ValorSchema,
} from '@/modules/clients/domain/regras/index';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const PADRAO_AGENTE = /^[A-Za-z0-9._:-]{1,80}$/;
const PADRAO_EXECUCAO = /^[A-Za-z0-9._:-]{1,120}$/;
const PADRAO_HASH = /^[0-9a-f]{64}$/;

const dataIso = z
  .string()
  .regex(DATA_ISO, 'Use AAAA-MM-DD.')
  .refine((texto) => !Number.isNaN(Date.parse(`${texto}T00:00:00.000Z`)), 'Data inválida.');

const textoOpcional = (maximo: number) =>
  z
    .string()
    .trim()
    .max(maximo)
    .nullish()
    .transform((texto) => (texto ? texto : null));

const identificador = z.string().uuid();

const motivoObrigatorio = z.string().trim().min(3, 'Informe o motivo (mínimo 3 caracteres).').max(LIMITES_DE_TAMANHO.motivo);

const camposDeConteudo = {
  forca: z.enum(FORCAS).optional(),
  titulo: textoOpcional(LIMITES_DE_TAMANHO.titulo),
  texto: textoOpcional(LIMITES_DE_TAMANHO.texto),
  valor: ValorSchema.nullish().transform((valor) => valor ?? null),
  vigenciaInicio: dataIso.nullish().transform((data) => data ?? null),
  vigenciaFim: dataIso.nullish().transform((data) => data ?? null),
  evidencia: textoOpcional(LIMITES_DE_TAMANHO.evidencia),
};

export const EntradaDeRegistroSchema = z
  .object({
    categoria: z.enum(CATEGORIAS),
    natureza: z.enum(NATUREZAS),
    chave: ChaveSchema.nullish().transform((chave) => chave ?? null),
    escopo: EscopoSchema.default('cliente'),
    contexto: textoOpcional(LIMITES_DE_TAMANHO.contexto),
    emNomeDe: textoOpcional(LIMITES_DE_TAMANHO.identificador),
    ...camposDeConteudo,
  })
  .strict();
export type EntradaDeRegistro = z.input<typeof EntradaDeRegistroSchema>;
export type EntradaDeRegistroValida = z.output<typeof EntradaDeRegistroSchema>;

export const EntradaDeSuperacaoSchema = z
  .object({
    decisaoId: identificador,
    motivo: motivoObrigatorio.nullish().transform((motivo) => motivo ?? null),
    emNomeDe: textoOpcional(LIMITES_DE_TAMANHO.identificador),
    ...camposDeConteudo,
  })
  .strict();
export type EntradaDeSuperacao = z.input<typeof EntradaDeSuperacaoSchema>;
export type EntradaDeSuperacaoValida = z.output<typeof EntradaDeSuperacaoSchema>;

export const EntradaDeRevogacaoSchema = z.object({ decisaoId: identificador, motivo: motivoObrigatorio }).strict();
export type EntradaDeRevogacao = z.input<typeof EntradaDeRevogacaoSchema>;

export const EntradaDeProposta = z
  .object({
    decisaoId: identificador,
    motivo: textoOpcional(LIMITES_DE_TAMANHO.motivo),
  })
  .strict();
export type EntradaDeDecisaoDeProposta = z.input<typeof EntradaDeProposta>;

export const FiltrosDaLinhaDoTempoSchema = z
  .object({
    categoria: z.enum(CATEGORIAS).nullish().transform((valor) => valor ?? null),
    origem: z.enum(ORIGENS).nullish().transform((valor) => valor ?? null),
    status: z.enum(STATUS).nullish().transform((valor) => valor ?? null),
    natureza: z.enum(NATUREZAS).nullish().transform((valor) => valor ?? null),
    cursor: z.number().int().min(1).nullish().transform((valor) => valor ?? null),
    limite: z.number().int().min(1).max(100).default(30),
  })
  .strict();
export type FiltrosDaLinhaDoTempoEntrada = z.input<typeof FiltrosDaLinhaDoTempoSchema>;

export const EntradaDaChaveSchema = z
  .object({
    chave: ChaveSchema,
    escopo: EscopoSchema.nullish().transform((valor) => valor ?? null),
  })
  .strict();
export type EntradaDaChave = z.input<typeof EntradaDaChaveSchema>;

export const EntradaDoAgenteSchema = z
  .object({
    agenteId: z.string().regex(PADRAO_AGENTE),
    execucaoId: z.string().regex(PADRAO_EXECUCAO),
    idempotencyKey: z.string().regex(PADRAO_EXECUCAO),
    hashDoConjuntoLido: z
      .string()
      .regex(PADRAO_HASH)
      .nullish()
      .transform((hash) => hash ?? null),
    categoria: z.enum(CATEGORIAS),
    natureza: z.enum(NATUREZAS),
    chave: ChaveSchema.nullish().transform((chave) => chave ?? null),
    escopo: EscopoSchema.default('cliente'),
    contexto: textoOpcional(LIMITES_DE_TAMANHO.contexto),
    ...camposDeConteudo,
  })
  .strict();
export type EntradaDoAgente = z.input<typeof EntradaDoAgenteSchema>;
export type EntradaDoAgenteValida = z.output<typeof EntradaDoAgenteSchema>;

export function detalhesDoZod(erro: z.ZodError): Record<string, string> {
  const detalhes: Record<string, string> = {};
  for (const problema of erro.issues) {
    const caminho = problema.path.length > 0 ? problema.path.join('.') : 'entrada';
    detalhes[caminho] ??= problema.message;
  }
  return detalhes;
}
