import { frescorPelaColeta } from './brain/frescor.ts';

export type EstadoDaFonte = 'ok' | 'atencao' | 'reautorizar' | 'vazio' | 'pausado';

export type VariacaoDoEstado = 'ok' | 'atencao' | 'reautorizar' | 'vazio' | 'pausada' | 'erro';

export type DadosDoEstado = {
  readonly precisaReautorizar: boolean;
  readonly coletaLigada: boolean;
  readonly comErro: boolean;
  readonly ultimaColeta: Date | null;
};

export type SituacaoDaFonte = {
  readonly estado: EstadoDaFonte;
  readonly variacao: VariacaoDoEstado;
  readonly rotulo: string;
  readonly prioridade: number;
};

const SITUACOES: Record<VariacaoDoEstado, SituacaoDaFonte> = {
  reautorizar: { estado: 'reautorizar', variacao: 'reautorizar', rotulo: 'Reautorizar', prioridade: 0 },
  erro: { estado: 'pausado', variacao: 'erro', rotulo: 'Erro', prioridade: 1 },
  atencao: { estado: 'atencao', variacao: 'atencao', rotulo: 'Atenção', prioridade: 2 },
  vazio: { estado: 'vazio', variacao: 'vazio', rotulo: 'Vazia', prioridade: 3 },
  pausada: { estado: 'pausado', variacao: 'pausada', rotulo: 'Pausada', prioridade: 4 },
  ok: { estado: 'ok', variacao: 'ok', rotulo: 'Ok', prioridade: 5 },
};

export function situacaoDaFonte(dados: DadosDoEstado, agora: Date): SituacaoDaFonte {
  if (dados.precisaReautorizar) return SITUACOES.reautorizar;
  if (dados.comErro) return SITUACOES.erro;
  if (!dados.coletaLigada) return SITUACOES.pausada;
  if (!dados.ultimaColeta) return SITUACOES.vazio;
  return frescorPelaColeta(dados.ultimaColeta, agora) === 'fresco' ? SITUACOES.ok : SITUACOES.atencao;
}

export function ordenarPorProblema<T extends { readonly situacao: SituacaoDaFonte; readonly nome: string }>(linhas: readonly T[]): T[] {
  return [...linhas].sort((a, b) => a.situacao.prioridade - b.situacao.prioridade || a.nome.localeCompare(b.nome, 'pt-BR'));
}

const HORA = 3_600_000;

export function atrasoDaColeta(ultimaColeta: Date | null, agora: Date): string | null {
  if (!ultimaColeta) return null;
  const horas = (agora.getTime() - ultimaColeta.getTime()) / HORA;
  if (horas <= 36) return null;
  const dias = Math.floor(horas / 24);
  return `${dias} ${dias === 1 ? 'dia' : 'dias'} de atraso`;
}

export function situacaoDeRecurso(precisaReautorizar: boolean): SituacaoDaFonte {
  return precisaReautorizar ? SITUACOES.reautorizar : SITUACOES.ok;
}
