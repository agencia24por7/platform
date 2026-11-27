import type { PedidoDaExecucao } from '@/modules/strategy/application/portas';

export { passouPeloComite, podeAplicar, type EventoDaCadeia, type StatusDaVersao } from '@/modules/strategy/domain/index';

export function pedidoParaOBancoEmMemoria(pedido: PedidoDaExecucao): Record<string, unknown> {
  if (pedido.tipo === 'criar') return { ...pedido.intencao };
  if (pedido.tipo === 'ajustar') return { instrucao: pedido.instrucao };
  if (pedido.tipo === 'corrigir_gate') return {};
  return { motivo: pedido.motivo };
}
