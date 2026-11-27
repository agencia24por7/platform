import type { CatalogoDeCampos, CampoDoCatalogo } from './tipos.ts';
import { campoNaoVerificado } from './tipos.ts';

export type CatalogoCompacto = {
  readonly plataforma: string;
  readonly objetivos: readonly string[];
  readonly campoDoObjetivo: string;
  readonly secoes: Readonly<Record<string, readonly string[]>>;
};

function linhaDoCampo(campo: CampoDoCatalogo): string {
  const obrigatorio = campo.obrigatorio ? '!' : '';
  const aplicavel = campo.aplicavelA === undefined ? '' : `@${campo.aplicavelA.join(',')}`;
  const naoVerificado = campoNaoVerificado(campo) ? '~' : '';
  const papel = campo.papel === undefined ? '' : `#${campo.papel}`;
  const opcoes = campo.opcoes === undefined ? '' : `(${campo.opcoes.join('/')})`;
  return `${campo.chave}:${campo.tipoDoValor}${obrigatorio}${aplicavel}${naoVerificado}${papel}${opcoes}`;
}

export function catalogoParaModelo(catalogo: CatalogoDeCampos): CatalogoCompacto {
  const secoes: Record<string, string[]> = {};
  for (const campo of catalogo.campos) (secoes[campo.secao] ??= []).push(linhaDoCampo(campo));
  return { plataforma: catalogo.plataforma, objetivos: catalogo.objetivos, campoDoObjetivo: catalogo.campoDoObjetivo, secoes };
}
