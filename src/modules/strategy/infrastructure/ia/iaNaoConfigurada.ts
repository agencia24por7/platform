import { err, type Result } from '@/shared/result/result';
import type { ErroDeIA, ExecutorDeIA, PedidoDeIA, RespostaDeIA } from '@/modules/strategy/application/portas';

export const MENSAGEM_IA_NAO_CONFIGURADA = 'A camada de IA não está configurada neste ambiente.';

export function criarIaNaoConfigurada(): ExecutorDeIA {
  return {
    async executar<T>(_pedido: PedidoDeIA<T>): Promise<Result<RespostaDeIA<T>, ErroDeIA>> {
      return err({ codigo: 'nao_configurada', mensagem: MENSAGEM_IA_NAO_CONFIGURADA });
    },
  };
}
