import type { Situacao } from '../ciclo.ts';
import type { Veredito } from './prontidao.ts';

export type TomDoIndicador = 'ok' | 'atencao' | 'critico' | 'neutro';
export type IconeDoVeredito = 'ok' | 'parcial' | 'nao';

export const TOM_DA_SITUACAO: Readonly<Record<Situacao, TomDoIndicador>> = { active: 'ok', paused: 'atencao', archived: 'neutro' };
export const TOM_DO_VEREDITO: Readonly<Record<Veredito, TomDoIndicador>> = { sim: 'ok', parcial: 'atencao', nao: 'critico' };
export const ICONE_DO_VEREDITO: Readonly<Record<Veredito, IconeDoVeredito>> = { sim: 'ok', parcial: 'parcial', nao: 'nao' };

const ROTULO_DO_MODELO: Readonly<Record<string, string>> = { ecommerce: 'E-commerce', leads: 'Geração de leads' };

export function rotuloDoModelo(modelo: string): string {
  return ROTULO_DO_MODELO[modelo] ?? ROTULO_DO_MODELO['leads']!;
}

export function tomDoPreenchimento(percentual: number): 'ok' | 'acento' | 'alerta' {
  if (percentual >= 70) return 'ok';
  return percentual >= 40 ? 'acento' : 'alerta';
}
