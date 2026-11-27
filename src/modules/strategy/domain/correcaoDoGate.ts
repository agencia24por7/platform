import { CHAVE_COMITE_COMPLETO } from './gate/comiteCompleto.ts';
import { problemaDoItem } from './gate/naoFaremosPreservado.ts';
import type { NaoFaremos, Plano } from './plano.ts';

export const MAXIMO_DE_CORRECOES_POR_VERSAO_RAIZ = 2;

export type ChecagemReprovada = { readonly chave: string; readonly motivo: string; readonly onde: readonly string[] };
export type ProblemaDoModelo = { readonly trecho: string; readonly problema: string };
export type FalhasDoGate = { readonly checagens: readonly ChecagemReprovada[]; readonly modelo: readonly ProblemaDoModelo[] };

function textoOuVazio(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

export function falhasDoGate(payload: Readonly<Record<string, unknown>> | null | undefined): FalhasDoGate | null {
  if (!payload || payload.resultado !== 'reprovado') return null;
  const checagens = Array.isArray(payload.checagens) ? (payload.checagens as Record<string, unknown>[]) : [];
  const reprovadas = checagens
    .filter((c) => c.resultado !== 'aprovado')
    .map((c): ChecagemReprovada => ({
      chave: textoOuVazio(c.chave),
      motivo: textoOuVazio(c.motivo),
      onde: Array.isArray(c.onde) ? c.onde.map(String) : [],
    }));
  const modelo = payload.modelo as { problemas?: Record<string, unknown>[] } | null | undefined;
  const doModelo = (modelo?.problemas ?? []).map((p): ProblemaDoModelo => ({ trecho: textoOuVazio(p.trecho), problema: textoOuVazio(p.problema) }));
  return { checagens: reprovadas, modelo: doModelo };
}

export function checagensCorrigiveis(falhas: FalhasDoGate): readonly ChecagemReprovada[] {
  return falhas.checagens.filter((c) => c.chave !== CHAVE_COMITE_COMPLETO);
}

export function restaurarNaoFaremos(plano: Plano, bases: readonly Plano[]): { readonly plano: Plano; readonly restauradas: readonly string[] } {
  const itens: NaoFaremos[] = [...plano.estrategia.nao_faremos];
  const restauradas = new Set<string>();
  for (const base of bases) {
    for (const item of base.estrategia.nao_faremos) {
      const posicao = itens.findIndex((atual) => atual.id === item.id);
      if (problemaDoItem(item, posicao === -1 ? undefined : itens[posicao]) === null) continue;
      if (posicao === -1) itens.push(item);
      else itens[posicao] = item;
      restauradas.add(item.id);
    }
  }
  if (restauradas.size === 0) return { plano, restauradas: [] };
  return { plano: { ...plano, estrategia: { ...plano.estrategia, nao_faremos: itens } }, restauradas: [...restauradas] };
}

export type ExecucaoParaContagem = {
  readonly tipo: string;
  readonly versaoBaseId: string | null;
  readonly agentRunId: string;
  readonly status: string;
  readonly tentativas: number;
};

const contaComoCorrecao = (execucao: ExecucaoParaContagem): boolean =>
  execucao.tipo === 'corrigir_gate' && (execucao.status !== 'cancelada' || execucao.tentativas > 0);

export function correcoesNaLinhagem(entrada: {
  readonly versaoBaseId: string;
  readonly execucoes: readonly ExecucaoParaContagem[];
  readonly agentRunIdDaVersao: (versaoId: string) => string | null;
}): number {
  const visitadas = new Set<string>();
  let atual: string | null = entrada.versaoBaseId;
  let total = 0;
  while (atual !== null && !visitadas.has(atual)) {
    visitadas.add(atual);
    const alvo: string = atual;
    total += entrada.execucoes.filter((e) => contaComoCorrecao(e) && e.versaoBaseId === alvo).length;
    const execucaoDaVersao: string | null = entrada.agentRunIdDaVersao(alvo);
    const criadora: ExecucaoParaContagem | undefined = execucaoDaVersao === null ? undefined : entrada.execucoes.find((e) => e.agentRunId === execucaoDaVersao);
    atual = criadora?.tipo === 'corrigir_gate' ? criadora.versaoBaseId : null;
  }
  return total;
}

export function podeCorrigirMais(correcoesFeitas: number): boolean {
  return correcoesFeitas < MAXIMO_DE_CORRECOES_POR_VERSAO_RAIZ;
}
