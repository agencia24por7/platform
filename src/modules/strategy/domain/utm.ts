import { PADRAO_DE_UTM, montarUtm, sanitizar } from '../../../shared/utm/utm.ts';
import type { Plataforma } from './plano.ts';

export type Utm = {
  readonly utm_source: string;
  readonly utm_medium: string;
  readonly utm_campaign: string;
};

export type UtmPorPlataforma = Partial<Record<Plataforma, Utm>>;

export type EntradaDeUtmDoPlano = {
  readonly tipoDePlano: string;
  readonly nomeDaCampanha: string;
  readonly periodo: string;
};

const TAMANHO_DO_PERIODO = 6;
const SEPARADORES_NA_CAMPANHA = 2;

function slugQueCabe(tipoDePlano: string, nomeDaCampanha: string): string {
  const folga = PADRAO_DE_UTM.tamanhoMaximo - sanitizar(tipoDePlano, 'tipoDePlano').length - TAMANHO_DO_PERIODO - SEPARADORES_NA_CAMPANHA;
  let slug: string;
  try {
    slug = sanitizar(nomeDaCampanha, 'nomeDaCampanha');
  } catch {
    return 'plano';
  }
  return slug.slice(0, Math.max(folga, 1)).replace(/-+$/g, '') || 'plano';
}

export function gerarUtmPorPlataforma(plataformas: readonly Plataforma[], entrada: EntradaDeUtmDoPlano): UtmPorPlataforma {
  const slugDoPlano = slugQueCabe(entrada.tipoDePlano, entrada.nomeDaCampanha);
  return Object.fromEntries(
    plataformas.map((plataforma) => {
      const { utm_source, utm_medium, utm_campaign } = montarUtm({
        plataforma,
        tipoDePlano: entrada.tipoDePlano,
        slugDoPlano,
        periodo: entrada.periodo,
      });
      return [plataforma, { utm_source, utm_medium, utm_campaign }];
    }),
  );
}
