import { err, ok, type Result } from '../../../shared/result/result.ts';

export type EventoParaAplicar =
  | { readonly tipo: 'parecer'; readonly agentRunId?: string | null }
  | { readonly tipo: 'ajuste'; readonly respondeA: string | null; readonly agentRunId?: string | null }
  | { readonly tipo: 'gate'; readonly resultado: 'aprovado' | 'reprovado'; readonly agentRunId?: string | null }
  | { readonly tipo: 'outro' };

export const MAXIMO_DE_SALTOS_DA_CADEIA = 10;

export type EventoDaCadeia = {
  readonly tipo: string;
  readonly atorTipo: string;
  readonly agentRunId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
};

export type EventosPorVersao = ReadonlyMap<string, readonly EventoDaCadeia[]>;

const PADRAO_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function respostaDoAjuste(eventos: readonly EventoDaCadeia[]): string | null {
  const ajuste = eventos.find((evento) => evento.tipo === 'ajuste');
  const alvo = ajuste?.payload.responde_a;
  return typeof alvo === 'string' && PADRAO_DE_UUID.test(alvo) ? alvo : null;
}

export function substituidaPor(substituida: string, nova: string, eventos: EventosPorVersao): boolean {
  return (eventos.get(substituida) ?? []).some(
    (evento) => evento.tipo === 'cancelada' && evento.atorTipo === 'sistema' && evento.payload.por === nova,
  );
}

export function passouPeloComite(versaoId: string, eventos: EventosPorVersao, execucaoEsperada: string | null = null): boolean {
  let atual = versaoId;
  let execucao = execucaoEsperada;
  for (let saltos = 0; saltos <= MAXIMO_DE_SALTOS_DA_CADEIA; saltos += 1) {
    const dela = eventos.get(atual) ?? [];
    const pareceres = dela.filter((evento) => evento.tipo === 'parecer');
    if (pareceres.length > 0) {
      const execucoes = new Set(pareceres.map((evento) => evento.agentRunId));
      const unica = [...execucoes][0] ?? null;
      return execucoes.size === 1 && unica !== null && (execucao === null || unica === execucao);
    }
    if (saltos === MAXIMO_DE_SALTOS_DA_CADEIA) return false;
    const respondida = respostaDoAjuste(dela);
    if (respondida === null) return false;
    const doAjuste = dela.find((evento) => evento.tipo === 'ajuste')?.agentRunId ?? null;
    if (doAjuste === null || (execucao !== null && doAjuste !== execucao)) return false;
    execucao = doAjuste;
    if (!substituidaPor(respondida, atual, eventos)) return false;
    atual = respondida;
  }
  return false;
}

export type FaltaParaAplicar = 'falta_parecer' | 'falta_gate' | 'gate_reprovado' | 'gate_anterior_ao_parecer' | 'gate_de_outra_execucao';

export const MENSAGEM_DA_FALTA: Readonly<Record<FaltaParaAplicar, string>> = {
  falta_parecer: 'Falta parecer do Comitê (próprio ou de uma versão que o ajuste responde).',
  falta_gate: 'Falta rodar os Gates.',
  gate_reprovado: 'O Gate mais recente reprovou.',
  gate_anterior_ao_parecer: 'O Gate mais recente é anterior a um parecer ou ajuste; rode os Gates de novo.',
  gate_de_outra_execucao: 'O Gate mais recente é de outra execução que a do Comitê desta versão; rode os Gates de novo.',
};

export type EntradaDeAplicacao = {
  readonly eventosDaVersao: readonly EventoParaAplicar[];
  readonly respondidaPassouPeloComite: boolean;
};

function indiceDoUltimo(eventos: readonly EventoParaAplicar[], tipo: EventoParaAplicar['tipo']): number {
  return eventos.map((e) => e.tipo).lastIndexOf(tipo);
}

export function podeAplicar(entrada: EntradaDeAplicacao): Result<true, readonly FaltaParaAplicar[]> {
  const { eventosDaVersao: eventos } = entrada;
  const faltas: FaltaParaAplicar[] = [];

  const execucoesDosPareceres = new Set(eventos.filter((e) => e.tipo === 'parecer').map((e) => (e.tipo === 'parecer' ? (e.agentRunId ?? null) : null)));
  const temParecerProprio = execucoesDosPareceres.size === 1;
  const ajusteQueResponde = eventos.some((e) => e.tipo === 'ajuste' && e.respondeA !== null);
  if (!temParecerProprio && !(ajusteQueResponde && entrada.respondidaPassouPeloComite)) faltas.push('falta_parecer');

  const posicaoDoGate = indiceDoUltimo(eventos, 'gate');
  const ultimoGate = eventos[posicaoDoGate];
  if (ultimoGate === undefined || ultimoGate.tipo !== 'gate') {
    faltas.push('falta_gate');
  } else {
    if (ultimoGate.resultado !== 'aprovado') faltas.push('gate_reprovado');
    const ultimaRevisao = Math.max(indiceDoUltimo(eventos, 'parecer'), indiceDoUltimo(eventos, 'ajuste'));
    if (posicaoDoGate < ultimaRevisao) faltas.push('gate_anterior_ao_parecer');
    const execucaoDoGate = ultimoGate.agentRunId;
    if (execucaoDoGate !== undefined) {
      const revisoes = eventos.filter((e) => e.tipo === 'parecer' || e.tipo === 'ajuste');
      if (execucaoDoGate === null || revisoes.some((e) => e.agentRunId !== undefined && e.agentRunId !== execucaoDoGate)) {
        faltas.push('gate_de_outra_execucao');
      }
    }
  }

  return faltas.length > 0 ? err(faltas) : ok(true);
}
