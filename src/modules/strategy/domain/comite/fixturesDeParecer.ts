import type { Parecer, PontoDoParecer, Veredito } from './parecer.ts';

export function ponto(id: string, trecho: string, fontes: string[] = [], sobrescrita: Partial<PontoDoParecer> = {}): PontoDoParecer {
  return { id, trecho, problema: `Problema ${id}.`, ajustePedido: `Ajuste ${id}.`, fontes, ...sobrescrita };
}

export function parecer(persona: string, veredito: Veredito, pontos: PontoDoParecer[] = []): Parecer {
  return { persona, veredito, motivo: `Motivo de ${persona}.`, pontos };
}
