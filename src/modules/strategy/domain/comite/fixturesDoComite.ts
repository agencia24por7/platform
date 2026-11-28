import { COMITES, NUMERO_DE_MESAS_DO_COMITE, PREFIXO_DA_TAREFA_DO_COMITE, chamadasPorRodadaDoComite, type Comite } from './comites.ts';
import { parecer } from './fixturesDeParecer.ts';
import { REAGE_AO_COMITE, type RodadaDaMesa } from './mesa.ts';

export type PedidoDoComite = { readonly tarefa: string; readonly chaveDeIdempotencia: string; readonly dados: unknown };

export const CHAMADAS_DOS_COMITES = COMITES.reduce((soma, comite) => soma + chamadasPorRodadaDoComite(comite), 0);
export const PARECERES_DOS_COMITES = COMITES.length;
export const MEMBROS_DOS_COMITES = COMITES.reduce((soma, comite) => soma + comite.membros.length, 0);
export { NUMERO_DE_MESAS_DO_COMITE };

export function ehPedidoDeComite(pedido: Pick<PedidoDoComite, 'tarefa'>): boolean {
  return pedido.tarefa.startsWith(PREFIXO_DA_TAREFA_DO_COMITE);
}

export function comiteDoPedido(pedido: Pick<PedidoDoComite, 'tarefa'>): Comite {
  const comite = COMITES.find((candidato) => candidato.tarefa === pedido.tarefa);
  if (!comite) throw new Error(`pedido de comitê desconhecido: ${pedido.tarefa}`);
  return comite;
}

export function membroDoPedido(pedido: Pick<PedidoDoComite, 'dados'>): string | null {
  return (pedido.dados as { persona?: { chave?: string } }).persona?.chave ?? null;
}

export function rodadaDoPedido(pedido: Pick<PedidoDoComite, 'chaveDeIdempotencia'>): 0 | 1 | 2 {
  const rodada = /:deliberacao:[a-z0-9_]+:([012])(?::|$)/.exec(pedido.chaveDeIdempotencia)?.[1];
  if (rodada === undefined) throw new Error(`chave sem rodada: ${pedido.chaveDeIdempotencia}`);
  return Number(rodada) as 0 | 1 | 2;
}

export function mesaQueConcorda(comite: Comite, rodada: 1 | 2): RodadaDaMesa {
  return {
    comite: comite.chave,
    rodada,
    debate: comite.membros.map((membro) => ({ membro: membro.chave, reageA: REAGE_AO_COMITE, posicao: `Posição de ${membro.chave}.`, mudouDeOpiniao: false })),
    consensos: [],
    divergencias: [],
  };
}

export function respostaDoComite(pedido: PedidoDoComite, parecerDoMembro: (membro: string, comite: Comite) => unknown = (membro) => parecer(membro, 'aprova')): unknown {
  const comite = comiteDoPedido(pedido);
  const rodada = rodadaDoPedido(pedido);
  if (rodada === 0) return parecerDoMembro(membroDoPedido(pedido) ?? '', comite);
  return mesaQueConcorda(comite, rodada);
}
