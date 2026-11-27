import { z } from 'zod';
import {
  ESQUEMAS_DAS_SECOES,
  esquemaMidiaDaPlataforma,
  type Plataforma,
  SCHEMA_VERSION,
  problemasDeIntegridadeParcial,
  type Intencao,
  type SecaoDoPlano,
  type SecoesParciaisDoPlano,
} from './plano.ts';

export type SecaoRedigida = Exclude<SecaoDoPlano, 'intencao'>;

export const GRUPOS_DE_REDACAO: readonly (readonly SecaoRedigida[])[] = [
  ['diagnostico', 'publico_alvo', 'comunidades_alvo'],
  ['posicionamento_e_mensagem', 'estrategia', 'canais_e_plataformas'],
  ['metas_e_metricas', 'medicao', 'campanhas'],
  ['orcamento', 'calendario', 'riscos_e_regras'],
  ['plano_de_midia'],
  ['lacunas', 'resumo_executivo'],
];

export const INDICE_DO_ULTIMO_GRUPO = GRUPOS_DE_REDACAO.length - 1;
export const INDICE_DO_PLANO_DE_MIDIA = GRUPOS_DE_REDACAO.findIndex((grupo) => (grupo as readonly string[]).includes('plano_de_midia'));

export function esquemaDaMidiaDaPlataforma(plataforma: Plataforma) {
  return z.strictObject({
    plano_de_midia: z.strictObject({
      plataformas: z.array(esquemaMidiaDaPlataforma).length(1),
    }),
  }).refine((saida) => saida.plano_de_midia.plataformas[0]?.plataforma === plataforma, { message: `O passo é só da plataforma ${plataforma}.` });
}

export type SaidaDaMidiaDaPlataforma = z.infer<ReturnType<typeof esquemaDaMidiaDaPlataforma>>;

export function mesclarMidiaDaPlataforma(
  atual: { readonly plataformas: readonly { readonly plataforma: string }[] } | undefined,
  nova: SaidaDaMidiaDaPlataforma['plano_de_midia'],
  ordem: readonly Plataforma[],
) {
  const entrada = nova.plataformas[0]!;
  const demais = (atual?.plataformas ?? []).filter((item) => item.plataforma !== entrada.plataforma);
  const todas = [...demais, entrada] as typeof nova.plataformas;
  const posicao = (item: { readonly plataforma: string }) => ordem.indexOf(item.plataforma as Plataforma);
  return { plataformas: [...todas].sort((a, b) => posicao(a) - posicao(b)) };
}

export function esquemaDoGrupo(indice: number) {
  const secoes = GRUPOS_DE_REDACAO[indice];
  if (!secoes) throw new Error(`Grupo de redação inexistente: ${indice}.`);
  return z.strictObject(Object.fromEntries(secoes.map((secao) => [secao, ESQUEMAS_DAS_SECOES[secao]])) as {
    [S in SecaoRedigida]?: (typeof ESQUEMAS_DAS_SECOES)[S];
  });
}

export function grupoDaSecao(secao: string): number | null {
  const indice = GRUPOS_DE_REDACAO.findIndex((grupo) => (grupo as readonly string[]).includes(secao));
  return indice === -1 ? null : indice;
}

export function grupoDoTrecho(trecho: string): number {
  return grupoDaSecao(trecho.split('/')[0] ?? '') ?? INDICE_DO_ULTIMO_GRUPO;
}

export const SECOES_DA_CHECAGEM: Readonly<Record<string, readonly SecaoRedigida[]>> = {
  urns_no_pacote: ['diagnostico'],
  evidencia_vigente: ['diagnostico'],
  meta_sem_nota_d: ['metas_e_metricas'],
  limites_do_cliente: ['metas_e_metricas', 'riscos_e_regras', 'lacunas'],
  nao_faremos: ['estrategia', 'campanhas'],
  nao_faremos_preservado: ['estrategia'],
  regra_legal_presente: ['riscos_e_regras'],
  secoes_obrigatorias: ['resumo_executivo'],
  orcamento_fecha: ['orcamento'],
  cobertura_do_plano_de_midia: ['plano_de_midia'],
  objetivo_com_metrica: ['metas_e_metricas', 'medicao'],
  comite_completo: ['resumo_executivo'],
};

function primeiroSegmento(caminho: string): string {
  return caminho.trim().split(/[/\s]/)[0] ?? '';
}

export function gruposDaPendenciaDoGate(chave: string, onde: readonly string[]): number[] {
  const grupos = new Set<number>();
  for (const caminho of onde) {
    const grupo = grupoDaSecao(primeiroSegmento(caminho));
    if (grupo !== null) grupos.add(grupo);
  }
  for (const secao of SECOES_DA_CHECAGEM[chave] ?? []) {
    const grupo = grupoDaSecao(secao);
    if (grupo !== null) grupos.add(grupo);
  }
  return grupos.size > 0 ? [...grupos].sort((a, b) => a - b) : [INDICE_DO_ULTIMO_GRUPO];
}

export type SecoesRedigidas = Partial<Record<SecaoRedigida, unknown>>;

export function secoesDoGrupo(plano: Record<string, unknown>, indice: number): SecoesRedigidas {
  const secoes = GRUPOS_DE_REDACAO[indice] ?? [];
  return Object.fromEntries(secoes.filter((secao) => plano[secao] !== undefined).map((secao) => [secao, plano[secao]]));
}

export function problemasDoRascunho(secoes: SecoesRedigidas) {
  return problemasDeIntegridadeParcial(secoes as SecoesParciaisDoPlano);
}

export function montarPlanoDeSecoes(intencao: Intencao, secoes: SecoesRedigidas): Record<string, unknown> {
  return { schema_version: SCHEMA_VERSION, intencao, ...secoes };
}
