import type { Frescor, StatusDeFrescor } from './entrada.ts';
import { diasEntre, hojeEmSaoPaulo, horasDesde, somarDias } from './tempo.ts';

export const CADENCIA_DIARIA = 'diaria';
export const TOLERANCIA_FRESCO_DIAS = 1;
export const LIMITE_ATRASADO_DIAS = 7;
export const HORAS_SEM_COLETA_ATRASADO = 48;
export const HORAS_SEM_COLETA_PARADO = 24 * 7;

export type EntradaDoFrescor = {
  readonly dadoAte: string | null;
  readonly ultimaAtualizacao: Date | null;
  readonly atrasoDias: number;
  readonly cadencia?: string;
  readonly agora: Date;
};

export function esperadoAte(atrasoDias: number, agora: Date): string {
  return somarDias(hojeEmSaoPaulo(agora), -Math.max(atrasoDias, 1));
}

function pior(a: StatusDeFrescor, b: StatusDeFrescor): StatusDeFrescor {
  const ordem: readonly StatusDeFrescor[] = ['fresco', 'atrasado', 'parado'];
  return ordem.indexOf(a) >= ordem.indexOf(b) ? a : b;
}

export function statusPorDado(dadoAte: string, esperado: string): StatusDeFrescor {
  if (dadoAte >= esperado) return 'fresco';
  const atraso = diasEntre(dadoAte, esperado) - 1;
  if (atraso <= TOLERANCIA_FRESCO_DIAS) return 'fresco';
  return atraso <= LIMITE_ATRASADO_DIAS ? 'atrasado' : 'parado';
}

export function statusPorExecucao(ultima: Date, agora: Date): StatusDeFrescor {
  const horas = horasDesde(ultima, agora);
  if (horas > HORAS_SEM_COLETA_PARADO) return 'parado';
  return horas > HORAS_SEM_COLETA_ATRASADO ? 'atrasado' : 'fresco';
}

export function calcularFrescor(entrada: EntradaDoFrescor): Frescor {
  const esperado = esperadoAte(entrada.atrasoDias, entrada.agora);
  const base = {
    ultimaAtualizacao: entrada.ultimaAtualizacao ? entrada.ultimaAtualizacao.toISOString() : null,
    dadoAte: entrada.dadoAte,
    esperadoAte: esperado,
    cadenciaEsperada: entrada.cadencia ?? CADENCIA_DIARIA,
  };
  if (entrada.dadoAte === null && entrada.ultimaAtualizacao === null) return { ...base, status: 'desconhecido' };
  const porDado = entrada.dadoAte ? statusPorDado(entrada.dadoAte, esperado) : 'fresco';
  const porExecucao = entrada.ultimaAtualizacao ? statusPorExecucao(entrada.ultimaAtualizacao, entrada.agora) : 'parado';
  return { ...base, status: pior(porDado, porExecucao) };
}

export function piorFrescor(lista: readonly StatusDeFrescor[]): StatusDeFrescor {
  const conhecidos = lista.filter((status) => status !== 'desconhecido');
  if (conhecidos.length === 0) return 'desconhecido';
  return conhecidos.reduce<StatusDeFrescor>((acc, status) => pior(acc, status), 'fresco');
}

export function melhorFrescor(lista: readonly StatusDeFrescor[]): StatusDeFrescor {
  const ordem: readonly StatusDeFrescor[] = ['fresco', 'atrasado', 'parado'];
  const conhecidos = lista.filter((status) => status !== 'desconhecido');
  if (conhecidos.length === 0) return 'desconhecido';
  return conhecidos.reduce((acc, status) => (ordem.indexOf(status) < ordem.indexOf(acc) ? status : acc));
}
