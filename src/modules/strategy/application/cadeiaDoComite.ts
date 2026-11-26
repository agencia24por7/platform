import {
  MAXIMO_DE_SALTOS_DA_CADEIA,
  esquemaParecer,
  respostaDoAjuste,
  type EventoDaCadeia,
  type Parecer,
} from '@/modules/strategy/domain/index';
import type { EventoDaVersao, RepositorioDeEstrategia } from '@/modules/strategy/application/portas';

export function paraEventoDaCadeia(eventos: readonly EventoDaVersao[]): EventoDaCadeia[] {
  return eventos.map((e) => ({ tipo: e.tipo, atorTipo: e.atorTipo, agentRunId: e.agentRunId, payload: e.payload }));
}

export async function carregarCadeia(
  repositorio: Pick<RepositorioDeEstrategia, 'eventosDaVersao'>,
  organizationId: string,
  versaoId: string,
  eventosDaVersao: readonly EventoDaVersao[],
): Promise<Map<string, readonly EventoDaCadeia[]>> {
  const mapa = new Map<string, readonly EventoDaCadeia[]>();
  mapa.set(versaoId, paraEventoDaCadeia(eventosDaVersao));
  let atual = versaoId;
  for (let salto = 0; salto < MAXIMO_DE_SALTOS_DA_CADEIA; salto += 1) {
    const respondida = respostaDoAjuste(mapa.get(atual) ?? []);
    if (respondida === null || mapa.has(respondida)) break;
    mapa.set(respondida, paraEventoDaCadeia(await repositorio.eventosDaVersao(organizationId, respondida)));
    if (mapa.get(respondida)!.some((e) => e.tipo === 'parecer')) break;
    atual = respondida;
  }
  return mapa;
}

export function versaoDaRaizDaCadeia(
  cadeia: ReadonlyMap<string, readonly EventoDaCadeia[]>,
  versaoId: string,
  execucaoEsperada: string | null = null,
): string | null {
  let atual = versaoId;
  let execucao = execucaoEsperada;
  for (let salto = 0; salto <= MAXIMO_DE_SALTOS_DA_CADEIA; salto += 1) {
    const eventos = cadeia.get(atual) ?? [];
    const pareceres = eventos.filter((e) => e.tipo === 'parecer');
    if (pareceres.length > 0) {
      const execucoes = new Set(pareceres.map((e) => e.agentRunId));
      const unica = [...execucoes][0] ?? null;
      return execucoes.size === 1 && unica !== null && (execucao === null || unica === execucao) ? atual : null;
    }
    const respondida = respostaDoAjuste(eventos);
    if (respondida === null) return null;
    const doAjuste = eventos.find((e) => e.tipo === 'ajuste')?.agentRunId ?? null;
    if (doAjuste === null || (execucao !== null && doAjuste !== execucao)) return null;
    execucao = doAjuste;
    atual = respondida;
  }
  return null;
}

export function pareceresDe(eventos: readonly EventoDaCadeia[]): Parecer[] {
  return eventos
    .filter((e) => e.tipo === 'parecer')
    .map((e) => esquemaParecer.safeParse(e.payload))
    .filter((lido): lido is { success: true; data: Parecer } => lido.success)
    .map((lido) => lido.data);
}
