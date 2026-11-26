import type { Evidencia } from './entrada.ts';

export type EntradaDeConhecimento = {
  readonly key: string;
  readonly version: number;
  readonly categoria: Evidencia['categoria'];
  readonly titulo: string;
  readonly resumo: string;
  readonly fonte: string;
  readonly nota: Evidencia['nota'];
  readonly maturidade: NonNullable<Evidencia['maturidade']> | null;
  readonly mercado: string;
  readonly jurisdicao: string;
  readonly dataDaFonte: string;
  readonly validoAte: string | null;
  readonly verificadoEm: string | null;
  readonly obrigatoria: boolean;
  readonly replicada: boolean;
  readonly criadaEm: Date;
};

export const JURISDICOES_PROJETADAS: readonly string[] = ['global', 'br'];

export function idDoConhecimento(entrada: Pick<EntradaDeConhecimento, 'key' | 'version'>): string {
  return `${entrada.key}-v${entrada.version}`;
}

export function ultimaVersaoAtiva(entradas: readonly EntradaDeConhecimento[]): readonly EntradaDeConhecimento[] {
  const ultimas = new Map<string, EntradaDeConhecimento>();
  for (const entrada of entradas) {
    const atual = ultimas.get(entrada.key);
    if (!atual || entrada.version > atual.version) ultimas.set(entrada.key, entrada);
  }
  return [...ultimas.values()];
}
