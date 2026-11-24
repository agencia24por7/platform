import { z } from 'zod';
import { err, ok, type Result } from '../../../../shared/result/result.ts';
import { CATEGORIAS_DE_LIMITE, type Categoria } from './categoria.ts';
import { MEDIDAS } from './medida.ts';
import { compararDecimais, DecimalSchema, UNIDADES, type Valor } from './valor.ts';

export const PERIODOS = ['mes', 'dia', 'total'] as const;
export type Periodo = (typeof PERIODOS)[number];

export const SENTIDOS = ['teto', 'piso'] as const;
export type Sentido = (typeof SENTIDOS)[number];

export const ESCOPO_DO_CLIENTE = 'cliente' as const;
const PADRAO_DE_ESCOPO = /^(cliente|plataforma:[a-z][a-z0-9_]{0,39})$/;
const PADRAO_DE_CHAVE = /^[a-z][a-z0-9_]{0,39}\.[a-z][a-z0-9_]{0,79}$/;
const CENTAVOS_INTEIROS = /^\d{1,15}$/;

export const EscopoSchema = z.string().regex(PADRAO_DE_ESCOPO, "Escopo é 'cliente' ou 'plataforma:<chave>'.");
export type Escopo = z.infer<typeof EscopoSchema>;
export const ChaveSchema = z
  .string()
  .regex(PADRAO_DE_CHAVE, 'Chave no formato grupo.nome em minúsculas (grupo até 40 e nome até 80 caracteres).');

export const DefinicaoDeLimiteSchema = z
  .object({
    key: ChaveSchema,
    version: z.number().int().min(1),
    nome: z.string().trim().min(1).max(120),
    descricao: z.string().trim().max(2000),
    categoria: z.enum(CATEGORIAS_DE_LIMITE),
    medida: z.enum(MEDIDAS),
    unidade: z.enum(UNIDADES),
    periodo: z.enum(PERIODOS),
    sentido: z.enum(SENTIDOS),
    faixaMin: DecimalSchema,
    faixaMax: DecimalSchema,
    escoposAceitos: z.array(EscopoSchema).min(1).max(50),
    essencial: z.boolean(),
    ativo: z.boolean(),
  })
  .strict()
  .superRefine((definicao, contexto) => {
    if (compararDecimais(definicao.faixaMin, definicao.faixaMax) > 0) {
      contexto.addIssue({ code: 'custom', path: ['faixaMin'], message: 'faixaMin não pode superar faixaMax.' });
    }
    if (definicao.unidade === 'brl_centavos') {
      for (const campo of ['faixaMin', 'faixaMax'] as const) {
        if (!CENTAVOS_INTEIROS.test(definicao[campo])) {
          contexto.addIssue({ code: 'custom', path: [campo], message: 'Em centavos a faixa é inteira.' });
        }
      }
    }
    if (new Set(definicao.escoposAceitos).size !== definicao.escoposAceitos.length) {
      contexto.addIssue({ code: 'custom', path: ['escoposAceitos'], message: 'Escopos repetidos.' });
    }
  });
export type DefinicaoDeLimite = z.infer<typeof DefinicaoDeLimiteSchema>;

export type ErroDeLimite = {
  readonly codigo:
    | 'categoria_incompativel'
    | 'unidade_incompativel'
    | 'abaixo_da_faixa'
    | 'acima_da_faixa'
    | 'escopo_nao_aceito';
  readonly mensagem: string;
};

export function validarLimiteContraDefinicao(
  definicao: DefinicaoDeLimite,
  limite: { readonly categoria: Categoria; readonly escopo: Escopo; readonly valor: Valor },
): Result<true, ErroDeLimite> {
  if (limite.categoria !== definicao.categoria) {
    return err({ codigo: 'categoria_incompativel', mensagem: 'A categoria difere da definição.' });
  }
  if (limite.valor.unidade !== definicao.unidade) {
    return err({ codigo: 'unidade_incompativel', mensagem: 'A unidade difere da definição.' });
  }
  if (!definicao.escoposAceitos.includes(limite.escopo)) {
    return err({ codigo: 'escopo_nao_aceito', mensagem: 'A definição não aceita este escopo.' });
  }
  const magnitude = limite.valor.unidade === 'brl_centavos' ? limite.valor.centavos : limite.valor.decimal;
  if (compararDecimais(magnitude, definicao.faixaMin) < 0) {
    return err({ codigo: 'abaixo_da_faixa', mensagem: 'O valor está abaixo da faixa permitida.' });
  }
  if (compararDecimais(magnitude, definicao.faixaMax) > 0) {
    return err({ codigo: 'acima_da_faixa', mensagem: 'O valor está acima da faixa permitida.' });
  }
  return ok(true);
}
