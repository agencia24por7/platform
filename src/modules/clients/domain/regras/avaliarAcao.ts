import type { Decisao } from './decisao.ts';
import { estaVigente, type ConjuntoVigente } from './vigentes.ts';
import type { DefinicaoDeLimite, Escopo, Periodo } from './definicaoDeLimite.ts';
import type { Medida } from './medida.ts';
import { compararValores, type Valor } from './valor.ts';

export type AcaoProposta = {
  readonly medida: Medida;
  readonly valorProposto: Valor;
  readonly periodo: Periodo;
  readonly escopo: Escopo;
  readonly agora: Date;
};

export type AvisoDeOrientacao = {
  readonly decisaoId: string;
  readonly numero: number;
  readonly chave: string | null;
};

export type ResultadoDaAvaliacao =
  | { readonly resultado: 'permitida'; readonly avisos?: readonly AvisoDeOrientacao[] }
  | {
      readonly resultado: 'bloqueada';
      readonly decisaoQueBloqueia: Decisao;
      readonly motivo: 'limite_violado' | 'definicao_ausente';
    }
  | { readonly resultado: 'sem_regra' };

function indiceDeDefinicoes(definicoes: readonly DefinicaoDeLimite[]): ReadonlyMap<string, DefinicaoDeLimite> {
  return new Map(definicoes.map((definicao) => [`${definicao.key}@${definicao.version}`, definicao]));
}

function violaLimite(definicao: DefinicaoDeLimite, limite: Valor, proposto: Valor): boolean {
  const comparacao = compararValores(proposto, limite);
  if (!comparacao.ok) return true;
  return definicao.sentido === 'teto' ? comparacao.value > 0 : comparacao.value < 0;
}

function aplicaAoEscopo(decisao: Decisao, escopoDaAcao: Escopo): boolean {
  return decisao.escopo === 'cliente' || decisao.escopo === escopoDaAcao;
}

export function avaliarAcao(
  definicoes: readonly DefinicaoDeLimite[],
  conjunto: ConjuntoVigente,
  acao: AcaoProposta,
): ResultadoDaAvaliacao {
  const indice = indiceDeDefinicoes(definicoes);
  const avisos: AvisoDeOrientacao[] = [];
  let encontrouRegra = false;

  const candidatas = conjunto.decisoes
    .filter((decisao) => decisao.natureza === 'limite' && decisao.valor !== null)
    .filter((decisao) => estaVigente(decisao, acao.agora) && aplicaAoEscopo(decisao, acao.escopo))
    .sort((a, b) => a.numero - b.numero);

  for (const decisao of candidatas) {
    if (decisao.valor === null) continue;
    const definicao = indice.get(`${decisao.definicaoChave}@${decisao.definicaoVersao}`);
    if (definicao === undefined) return { resultado: 'bloqueada', decisaoQueBloqueia: decisao, motivo: 'definicao_ausente' };
    if (definicao.medida !== acao.medida || definicao.periodo !== acao.periodo) continue;
    encontrouRegra = true;
    if (!violaLimite(definicao, decisao.valor, acao.valorProposto)) continue;
    if (decisao.forca === 'dura') return { resultado: 'bloqueada', decisaoQueBloqueia: decisao, motivo: 'limite_violado' };
    avisos.push({ decisaoId: decisao.id, numero: decisao.numero, chave: decisao.chave });
  }

  if (!encontrouRegra) return { resultado: 'sem_regra' };
  return avisos.length > 0 ? { resultado: 'permitida', avisos } : { resultado: 'permitida' };
}
