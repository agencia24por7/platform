import type { NaoFaremos } from '../plano.ts';
import { aprovar, montarResultado, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_NAO_FAREMOS_PRESERVADO = 'nao_faremos_preservado';

const normalizarEspacos = (texto: string): string => texto.replace(/\s+/g, ' ').trim();

export function problemaDoItem(base: NaoFaremos, atual: NaoFaremos | undefined): string | null {
  if (atual === undefined) return `estrategia/${base.id} (removido em relação à versão base)`;
  if (base.teste === undefined) {
    return normalizarEspacos(base.texto) === normalizarEspacos(atual.texto)
      ? null
      : `estrategia/${base.id} (texto reescrito: item só de texto tem de continuar idêntico)`;
  }
  if (atual.teste === undefined || atual.teste.tipo !== base.teste.tipo || atual.teste.valor !== base.teste.valor) {
    return `estrategia/${base.id} (teste estruturado afrouxado ou alterado)`;
  }
  return null;
}

export function checarNaoFaremosPreservado(contexto: ContextoDoGate): ResultadoDaChecagem {
  const { plano, planosBase, exigePlanoBase } = contexto;
  if (planosBase === undefined || planosBase.length === 0) {
    if (exigePlanoBase === true) {
      return montarResultado(CHAVE_NAO_FAREMOS_PRESERVADO, 'nao_rodou', 'Versão de agente com base e plano base ausente no contexto.', ['estrategia/nao_faremos']);
    }
    return aprovar(CHAVE_NAO_FAREMOS_PRESERVADO, 'Versão sem base: nada a preservar.');
  }
  const atuais = new Map(plano.estrategia.nao_faremos.map((item) => [item.id, item]));
  const problemas = new Set<string>();
  for (const base of planosBase) {
    for (const item of base.estrategia.nao_faremos) {
      const problema = problemaDoItem(item, atuais.get(item.id));
      if (problema !== null) problemas.add(problema);
    }
  }
  if (problemas.size > 0) {
    return reprovar(CHAVE_NAO_FAREMOS_PRESERVADO, `${problemas.size} "não faremos" das versões base perdido(s), afrouxado(s) ou reescrito(s).`, [...problemas]);
  }
  return aprovar(CHAVE_NAO_FAREMOS_PRESERVADO, 'Todo "não faremos" das versões base continua presente, com o mesmo teste ou o mesmo texto.');
}
