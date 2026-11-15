export const CausaFaltante = {
  SemCredencial: 'sem_credencial',
  ReauthPending: 'reauth_pending',
  ApiRecusou: 'api_recusou',
  SemDadosNoPeriodo: 'sem_dados_no_periodo',
  ForaDoV1: 'fora_do_v1',
} as const;
export type CausaFaltante = (typeof CausaFaltante)[keyof typeof CausaFaltante];

export type Faltante = {
  readonly fonte: string;
  readonly causa: CausaFaltante;
  readonly detalhe: string | null;
};

export type AchadoDeParidade = {
  readonly fonte: string;
  readonly tipo: 'rotulo_divergente' | 'campo_ausente' | 'dimensao_nova' | 'escopo_ausente' | 'escopo_excedente';
  readonly esperado: string;
  readonly observado: string | null;
};

export type Volumetria = {
  readonly linhas: number;
  readonly bytes: number;
  readonly requests: number;
  readonly duracaoMs: number;
};

export type RelatorioDeExecucao = {
  readonly fontesEsperadas: number;
  readonly fontesColetadas: number;
  readonly faltantes: readonly Faltante[];
  readonly paridade: readonly AchadoDeParidade[];
  readonly volumetria: Volumetria;
};

export function consolidarQualidade(
  fontesEsperadas: readonly string[],
  resultados: readonly { readonly fonte: string; readonly ok: boolean; readonly causa?: CausaFaltante; readonly detalhe?: string }[],
  paridade: readonly AchadoDeParidade[],
  volumetria: Volumetria,
): RelatorioDeExecucao {
  const porFonte = new Map(resultados.map((resultado) => [resultado.fonte, resultado]));

  const faltantes: Faltante[] = [];
  let fontesColetadas = 0;

  for (const fonte of fontesEsperadas) {
    const resultado = porFonte.get(fonte);
    if (resultado?.ok) {
      fontesColetadas += 1;
      continue;
    }
    faltantes.push({
      fonte,
      causa: resultado?.causa ?? CausaFaltante.ApiRecusou,
      detalhe: resultado?.detalhe ?? null,
    });
  }

  return {
    fontesEsperadas: fontesEsperadas.length,
    fontesColetadas,
    faltantes,
    paridade,
    volumetria,
  };
}

export function taxaDeSucesso(relatorio: RelatorioDeExecucao): number {
  if (relatorio.fontesEsperadas === 0) return 1;
  return relatorio.fontesColetadas / relatorio.fontesEsperadas;
}
