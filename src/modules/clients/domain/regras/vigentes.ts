import { createHash } from 'node:crypto';
import type { Decisao } from './decisao.ts';
import { jsonEstavel } from '../contexto/jsonEstavel.ts';

export type ConjuntoVigente = {
  readonly decisoes: readonly Decisao[];
  readonly porChaveEEscopo: ReadonlyMap<string, Decisao>;
  readonly conflitos: readonly Decisao[];
};

export function estaVigente(decisao: Decisao, agora: Date): boolean {
  if (decisao.status !== 'vigente') return false;
  if (decisao.vigenciaInicio.getTime() > agora.getTime()) return false;
  return decisao.vigenciaFim === null || agora.getTime() < decisao.vigenciaFim.getTime();
}

export function chaveDoIndice(decisao: Pick<Decisao, 'clienteId' | 'natureza' | 'chave' | 'escopo'>): string {
  return jsonEstavel([decisao.clienteId, decisao.natureza, decisao.chave, decisao.escopo]);
}

export function derivarVigentes(decisoes: readonly Decisao[], agora: Date): ConjuntoVigente {
  const vigentes = decisoes.filter((decisao) => estaVigente(decisao, agora)).sort((a, b) => a.numero - b.numero);
  const porChaveEEscopo = new Map<string, Decisao>();
  const conflitos: Decisao[] = [];
  for (const decisao of vigentes) {
    if (decisao.chave === null) continue;
    const indice = chaveDoIndice(decisao);
    const existente = porChaveEEscopo.get(indice);
    if (existente !== undefined) conflitos.push(existente);
    porChaveEEscopo.set(indice, decisao);
  }
  const perdedores = new Set(conflitos.map((decisao) => decisao.id));
  return {
    decisoes: vigentes.filter((decisao) => !perdedores.has(decisao.id)),
    porChaveEEscopo,
    conflitos,
  };
}

export function hashDoConjunto(decisoes: readonly Decisao[]): string {
  const ordenadas = [...decisoes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return createHash('sha256').update(jsonEstavel(ordenadas)).digest('hex');
}
