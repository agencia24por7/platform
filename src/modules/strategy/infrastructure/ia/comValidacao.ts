import { err, ok, type Result } from '@/shared/result/result';
import type { ErroDeIA, ExecutorDeIA, PedidoDeIA, RespostaDeIA } from '@/modules/strategy/application/portas';

const FALHA_INESPERADA: ErroDeIA = { codigo: 'falha_do_fornecedor', mensagem: 'A camada de IA falhou de forma inesperada.' };
const TEMPO_ESGOTADO: ErroDeIA = { codigo: 'tempo_esgotado', mensagem: 'A chamada à camada de IA passou do tempo máximo.' };
const SAIDA_INVALIDA: ErroDeIA = { codigo: 'saida_invalida', mensagem: 'A saída da camada de IA não bate com o esquema do pedido.' };

function caminhosDoEsquema(erro: { readonly issues: readonly { readonly path: readonly PropertyKey[] }[] }): string {
  const caminhos = [...new Set(erro.issues.slice(0, 3).map((problema) => problema.path.map(String).join('.').replace(/[^a-z0-9_.]/gi, '').slice(0, 60)))];
  return `esquema:${caminhos.join(',')}`.slice(0, 160);
}

type Corrida<T> = { readonly tipo: 'resposta'; readonly resultado: Result<RespostaDeIA<T>, ErroDeIA> } | { readonly tipo: 'tempo' };

export function comValidacao(executor: ExecutorDeIA): ExecutorDeIA {
  return {
    ...(executor.prefixoEstavel === undefined ? {} : { prefixoEstavel: (dadosDaCoorte: readonly unknown[]) => executor.prefixoEstavel!(dadosDaCoorte) }),
    async executar<T>(pedido: PedidoDeIA<T>): Promise<Result<RespostaDeIA<T>, ErroDeIA>> {
      const tempoMaximoMs = pedido.orcamento.tempoMaximoMs;
      if (!Number.isFinite(tempoMaximoMs) || tempoMaximoMs <= 0) return err(TEMPO_ESGOTADO);

      const controlador = new AbortController();
      const aoAbortarOPedido = () => controlador.abort();
      pedido.sinal?.addEventListener('abort', aoAbortarOPedido, { once: true });
      if (pedido.sinal?.aborted) controlador.abort();
      let temporizador: ReturnType<typeof setTimeout> | undefined;
      const prazo = new Promise<Corrida<T>>((resolver) => {
        temporizador = setTimeout(() => {
          controlador.abort();
          resolver({ tipo: 'tempo' });
        }, tempoMaximoMs);
      });
      const chamada = (async (): Promise<Corrida<T>> => {
        try {
          return { tipo: 'resposta', resultado: await executor.executar({ ...pedido, sinal: controlador.signal }) };
        } catch {
          return { tipo: 'resposta', resultado: err(FALHA_INESPERADA) };
        }
      })();

      try {
        const corrida = await Promise.race([chamada, prazo]);
        if (corrida.tipo === 'tempo') return err(TEMPO_ESGOTADO);
        if (!corrida.resultado.ok) return err(corrida.resultado.error);
        const lida = pedido.esquema.safeParse(corrida.resultado.value.saida);
        if (!lida.success) return err({ ...SAIDA_INVALIDA, mensagem: `${SAIDA_INVALIDA.mensagem} [${caminhosDoEsquema(lida.error)}]`, ...(corrida.resultado.value.telemetria === undefined ? {} : { telemetria: corrida.resultado.value.telemetria }) });
        const { telemetria } = corrida.resultado.value;
        return ok({ saida: lida.data, uso: corrida.resultado.value.uso, ...(telemetria === undefined ? {} : { telemetria }) });
      } catch {
        return err(FALHA_INESPERADA);
      } finally {
        if (temporizador !== undefined) clearTimeout(temporizador);
        pedido.sinal?.removeEventListener('abort', aoAbortarOPedido);
      }
    },
  };
}
