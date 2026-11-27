import { z } from 'zod';
import { PLATAFORMAS, esquemaId, type Plataforma } from '../plano.ts';

export const TIPOS_DE_VALOR_DO_CAMPO = ['texto', 'numero', 'booleano', 'lista', 'escolha'] as const;
export type TipoDoValor = (typeof TIPOS_DE_VALOR_DO_CAMPO)[number];

export const EVIDENCIAS_DA_API = ['comprovado', 'nao_verificado_pela_api'] as const;
export type EvidenciaDaApi = (typeof EVIDENCIAS_DA_API)[number];

export const VALOR_A_CONFIRMAR = 'a_confirmar';

export const esquemaCampoDoCatalogo = z
  .strictObject({
    chave: esquemaId,
    secao: esquemaId,
    obrigatorio: z.boolean(),
    aplicavelA: z.array(esquemaId).min(1).max(60).optional(),
    evidenciaDaApi: z.enum(EVIDENCIAS_DA_API).optional(),
    tipoDoValor: z.enum(TIPOS_DE_VALOR_DO_CAMPO),
    opcoes: z.array(z.string().min(1).max(120)).max(200).optional(),
  })
  .refine((campo) => (campo.tipoDoValor === 'escolha') === (campo.opcoes !== undefined && campo.opcoes.length > 0), {
    message: 'Só o campo do tipo escolha tem opções, e ele precisa de pelo menos uma.',
  });

export const esquemaCatalogoDeCampos = z
  .strictObject({
    plataforma: z.enum(PLATAFORMAS),
    versaoDaApi: z.string().min(1).max(40),
    objetivos: z.array(esquemaId).min(1).max(60),
    campoDoObjetivo: esquemaId,
    campos: z.array(esquemaCampoDoCatalogo).min(1).max(600),
  })
  .refine((catalogo) => new Set(catalogo.campos.map((campo) => campo.chave)).size === catalogo.campos.length, {
    message: 'Chave de campo repetida no catálogo.',
  })
  .refine((catalogo) => catalogo.campos.some((campo) => campo.chave === catalogo.campoDoObjetivo), {
    message: 'O campo do objetivo precisa existir no catálogo.',
  })
  .refine((catalogo) => catalogo.campos.every((campo) => (campo.aplicavelA ?? []).every((objetivo) => catalogo.objetivos.includes(objetivo))), {
    message: 'aplicavelA cita objetivo que o catálogo não declara.',
  });

export type CampoDoCatalogo = z.infer<typeof esquemaCampoDoCatalogo>;
export type CatalogoDeCampos = z.infer<typeof esquemaCatalogoDeCampos>;

export function catalogoDaPlataforma(catalogos: readonly CatalogoDeCampos[] | undefined, plataforma: Plataforma): CatalogoDeCampos | undefined {
  return catalogos?.find((catalogo) => catalogo.plataforma === plataforma);
}

export function objetivoDoValor(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  return valor.toLowerCase().replace(/^outcome_/, '');
}

export function campoAplicavel(campo: CampoDoCatalogo, objetivo: string | undefined): boolean {
  return campo.aplicavelA === undefined || (objetivo !== undefined && campo.aplicavelA.includes(objetivo));
}

export function campoNaoVerificado(campo: CampoDoCatalogo): boolean {
  return campo.evidenciaDaApi === 'nao_verificado_pela_api';
}
