import { CATALOGOS_DISPONIVEIS } from '../catalogo/disponiveis.ts';
import type { CatalogoDeCampos } from '../catalogo/tipos.ts';
import { LIMITES_DE_LISTA, LIMITES_DE_TEXTO } from '../gate/dependenciasDoGoogle.ts';
import type { Plataforma } from '../plano.ts';

export const MIDIAS_DO_CAMPO = ['texto', 'imagem', 'video'] as const;
export type MidiaDoCampo = (typeof MIDIAS_DO_CAMPO)[number];

export type EspecificacaoDoCampo = {
  readonly plataforma: Plataforma;
  readonly campo: string;
  readonly midia: MidiaDoCampo;
  readonly maximoDePecas: number | null;
  readonly caracteres: number | null;
  readonly proporcao: string | null;
};

type CampoDeCriativo = { readonly campo: string; readonly midia: MidiaDoCampo; readonly proporcao?: string };

const CRIATIVOS_DA_META: readonly CampoDeCriativo[] = [
  { campo: 'creative_message', midia: 'texto' },
  { campo: 'creative_headline', midia: 'texto' },
  { campo: 'creative_description', midia: 'texto' },
  { campo: 'creative_image_hash', midia: 'imagem' },
  { campo: 'creative_video_id', midia: 'video' },
];

const CRIATIVOS_DO_GOOGLE: readonly CampoDeCriativo[] = [
  { campo: 'ad_headlines', midia: 'texto' },
  { campo: 'ad_descriptions', midia: 'texto' },
  { campo: 'ad_path1', midia: 'texto' },
  { campo: 'ad_path2', midia: 'texto' },
  { campo: 'ad_display_headlines', midia: 'texto' },
  { campo: 'ad_display_long_headline', midia: 'texto' },
  { campo: 'ad_display_descriptions', midia: 'texto' },
  { campo: 'ad_display_business_name', midia: 'texto' },
  { campo: 'ad_display_call_to_action_text', midia: 'texto' },
  { campo: 'ad_display_marketing_images', midia: 'imagem', proporcao: '1.91:1' },
  { campo: 'ad_display_square_marketing_images', midia: 'imagem', proporcao: '1:1' },
  { campo: 'ad_display_logo_images', midia: 'imagem', proporcao: '4:1' },
  { campo: 'ad_display_square_logo_images', midia: 'imagem', proporcao: '1:1' },
  { campo: 'ad_display_youtube_videos', midia: 'video' },
  { campo: 'assetgroup_pmax_path1', midia: 'texto' },
  { campo: 'assetgroup_pmax_path2', midia: 'texto' },
  { campo: 'assetgroup_pmax_headlines', midia: 'texto' },
  { campo: 'assetgroup_pmax_long_headlines', midia: 'texto' },
  { campo: 'assetgroup_pmax_descriptions', midia: 'texto' },
  { campo: 'assetgroup_pmax_business_name', midia: 'texto' },
  { campo: 'assetgroup_pmax_marketing_images', midia: 'imagem', proporcao: '1.91:1' },
  { campo: 'assetgroup_pmax_square_marketing_images', midia: 'imagem', proporcao: '1:1' },
  { campo: 'assetgroup_pmax_portrait_marketing_images', midia: 'imagem' },
  { campo: 'assetgroup_pmax_logos', midia: 'imagem' },
  { campo: 'assetgroup_pmax_landscape_logos', midia: 'imagem' },
  { campo: 'assetgroup_pmax_youtube_video', midia: 'video' },
  { campo: 'ad_dg_headlines', midia: 'texto' },
  { campo: 'ad_dg_descriptions', midia: 'texto' },
  { campo: 'ad_dg_business_name', midia: 'texto' },
  { campo: 'ad_dg_marketing_images', midia: 'imagem' },
  { campo: 'ad_dg_square_marketing_images', midia: 'imagem' },
  { campo: 'ad_dg_portrait_marketing_images', midia: 'imagem' },
  { campo: 'ad_dg_tall_portrait_marketing_images', midia: 'imagem' },
  { campo: 'ad_dg_logo_images', midia: 'imagem' },
  { campo: 'ad_dg_video_videos', midia: 'video' },
  { campo: 'ad_dg_video_long_headlines', midia: 'texto' },
  { campo: 'ad_dg_video_breadcrumb1', midia: 'texto' },
  { campo: 'ad_dg_video_breadcrumb2', midia: 'texto' },
  { campo: 'ad_app_headlines', midia: 'texto' },
  { campo: 'ad_app_descriptions', midia: 'texto' },
  { campo: 'ad_app_images', midia: 'imagem' },
  { campo: 'ad_app_youtube_videos', midia: 'video' },
];

export const CAMPOS_DE_CRIATIVO: Readonly<Partial<Record<Plataforma, readonly CampoDeCriativo[]>>> = {
  meta: CRIATIVOS_DA_META,
  google: CRIATIVOS_DO_GOOGLE,
};

const LISTAS = new Map(LIMITES_DE_LISTA);
const TEXTOS = new Map(LIMITES_DE_TEXTO);

function especificacaoDe(plataforma: Plataforma, campo: CampoDeCriativo, catalogo: CatalogoDeCampos): EspecificacaoDoCampo | null {
  const doCatalogo = catalogo.campos.find((candidato) => candidato.chave === campo.campo);
  if (doCatalogo === undefined) return null;
  const lista = LISTAS.get(campo.campo);
  const texto = TEXTOS.get(campo.campo);
  const maximoDePecas = lista?.maximo ?? (doCatalogo.tipoDoValor === 'lista' ? null : 1);
  return {
    plataforma,
    campo: campo.campo,
    midia: campo.midia,
    maximoDePecas,
    caracteres: lista?.caracteres ?? texto ?? null,
    proporcao: campo.proporcao ?? null,
  };
}

export function especificacoesDaPlataforma(
  plataforma: Plataforma,
  catalogos: readonly CatalogoDeCampos[] = CATALOGOS_DISPONIVEIS,
): readonly EspecificacaoDoCampo[] | null {
  const catalogo = catalogos.find((candidato) => candidato.plataforma === plataforma);
  const campos = CAMPOS_DE_CRIATIVO[plataforma];
  if (catalogo === undefined || campos === undefined) return null;
  return campos.map((campo) => especificacaoDe(plataforma, campo, catalogo)).filter((item): item is EspecificacaoDoCampo => item !== null);
}

export function especificacaoParaModelo(especificacao: EspecificacaoDoCampo): string {
  const pecas = especificacao.maximoDePecas === null ? '' : `x${especificacao.maximoDePecas}`;
  const caracteres = especificacao.caracteres === null ? '' : `<=${especificacao.caracteres}c`;
  const proporcao = especificacao.proporcao === null ? '' : `@${especificacao.proporcao}`;
  return `${especificacao.campo}:${especificacao.midia}${pecas}${caracteres}${proporcao}`;
}
