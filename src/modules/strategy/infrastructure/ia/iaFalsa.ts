import { err, ok, type Result } from '@/shared/result/result';
import type { ErroDeIA, ExecutorDeIA, PedidoDeIA, RespostaDeIA, UsoDeIA } from '@/modules/strategy/application/portas';

export type RoteiroDaIaFalsa = (pedido: PedidoDeIA<unknown>) => unknown | Promise<unknown>;

export type IaFalsa = ExecutorDeIA & {
  readonly pedidos: readonly PedidoDeIA<unknown>[];
  limpar(): void;
};

const TEMPO_ESGOTADO: ErroDeIA = { codigo: 'tempo_esgotado', mensagem: 'A chamada foi abortada pelo tempo máximo.' };
const USO_PADRAO: UsoDeIA = { tokensDeEntrada: 0, tokensDeSaida: 0, modelo: 'ia-falsa' };

export function ehErroDeIA(valor: unknown): valor is ErroDeIA {
  if (valor === null || typeof valor !== 'object') return false;
  const candidato = valor as { codigo?: unknown; mensagem?: unknown };
  return (
    typeof candidato.mensagem === 'string' &&
    ['nao_configurada', 'limite_atingido', 'saida_invalida', 'falha_do_fornecedor', 'tempo_esgotado'].includes(String(candidato.codigo))
  );
}

function ehSaidaDoJuiz(valor: unknown): boolean {
  return valor !== null && typeof valor === 'object' && Array.isArray((valor as { vereditos?: unknown }).vereditos);
}

export function aceitaTodos(dados: unknown): unknown {
  const pontos = (dados as { pontos?: { persona: string; pontoId: string }[] }).pontos ?? [];
  return { vereditos: pontos.map((p) => ({ persona: p.persona, pontoId: p.pontoId, veredito: 'aceito', motivo: 'aceito', prova: [] })) };
}

export function criarIaFalsa(roteiro: RoteiroDaIaFalsa, uso: UsoDeIA = USO_PADRAO): IaFalsa {
  const pedidos: PedidoDeIA<unknown>[] = [];
  return {
    pedidos,
    limpar() {
      pedidos.length = 0;
    },
    async executar<T>(pedido: PedidoDeIA<T>): Promise<Result<RespostaDeIA<T>, ErroDeIA>> {
      pedidos.push(pedido as PedidoDeIA<unknown>);
      if (pedido.sinal?.aborted) return err(TEMPO_ESGOTADO);
      const saida = await roteiro(pedido as PedidoDeIA<unknown>);
      if (pedido.sinal?.aborted) return err(TEMPO_ESGOTADO);
      if (ehErroDeIA(saida)) return err(saida);
      const lida = pedido.esquema.safeParse(pedido.tarefa === 'juiz' && !ehSaidaDoJuiz(saida) ? aceitaTodos(pedido.dados) : saida);
      if (!lida.success) return err({ codigo: 'saida_invalida', mensagem: 'A saída do roteiro não bate com o esquema do pedido.' });
      return ok({ saida: lida.data, uso });
    },
  };
}
