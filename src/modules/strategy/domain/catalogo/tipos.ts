import { z } from 'zod';
import { PLATAFORMAS, esquemaId, type Plataforma } from '../plano.ts';

export const TIPOS_DE_VALOR_DO_CAMPO = ['texto', 'numero', 'booleano', 'lista', 'escolha'] as const;
export type TipoDoValor = (typeof TIPOS_DE_VALOR_DO_CAMPO)[number];

export const esquemaCampoDoCatalogo = z
  .strictObject({
    chave: esquemaId,
    secao: esquemaId,
    obrigatorio: z.boolean(),
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
    campos: z.array(esquemaCampoDoCatalogo).min(1).max(600),
  })
  .refine((catalogo) => new Set(catalogo.campos.map((campo) => campo.chave)).size === catalogo.campos.length, {
    message: 'Chave de campo repetida no catálogo.',
  });

export type CampoDoCatalogo = z.infer<typeof esquemaCampoDoCatalogo>;
export type CatalogoDeCampos = z.infer<typeof esquemaCatalogoDeCampos>;

export function catalogoDaPlataforma(catalogos: readonly CatalogoDeCampos[] | undefined, plataforma: Plataforma): CatalogoDeCampos | undefined {
  return catalogos?.find((catalogo) => catalogo.plataforma === plataforma);
}
