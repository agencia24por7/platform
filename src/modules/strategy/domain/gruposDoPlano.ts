import { z } from 'zod';
import {
  ESQUEMAS_DAS_SECOES,
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
  ['criativos', 'metas_e_metricas', 'medicao'],
  ['campanhas', 'orcamento', 'calendario'],
  ['riscos_e_regras', 'lacunas', 'resumo_executivo'],
];

export const INDICE_DO_ULTIMO_GRUPO = GRUPOS_DE_REDACAO.length - 1;

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
  limites_do_cliente: ['metas_e_metricas', 'riscos_e_regras'],
  nao_faremos: ['estrategia', 'campanhas'],
  nao_faremos_preservado: ['estrategia'],
  regra_legal_presente: ['riscos_e_regras'],
  secoes_obrigatorias: ['resumo_executivo'],
  orcamento_fecha: ['orcamento'],
  objetivo_com_metrica: ['metas_e_metricas', 'medicao'],
  comite_completo: ['resumo_executivo'],
};

function primeiroSegmento(caminho: string): string {
  return caminho.trim().split(/[/\s]/)[0] ?? '';
}

export function gruposDaPendenciaDoGate(chave: string, onde: readonly string[]): number[] {
  const dosCaminhos = new Set<number>();
  for (const caminho of onde) {
    const grupo = grupoDaSecao(primeiroSegmento(caminho));
    if (grupo !== null) dosCaminhos.add(grupo);
  }
  if (dosCaminhos.size > 0) return [...dosCaminhos].sort((a, b) => a - b);
  const dosMapa = new Set<number>();
  for (const secao of SECOES_DA_CHECAGEM[chave] ?? []) {
    const grupo = grupoDaSecao(secao);
    if (grupo !== null) dosMapa.add(grupo);
  }
  return dosMapa.size > 0 ? [...dosMapa].sort((a, b) => a - b) : [INDICE_DO_ULTIMO_GRUPO];
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
