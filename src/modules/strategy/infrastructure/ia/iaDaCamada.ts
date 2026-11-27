import { createHash } from 'node:crypto';
import { SEM_MODELO_CONFIGURADO, type Executor } from '@/modules/ia/application/execucao';
import { MENSAGEM_DO_BLOQUEIO } from '@/modules/ia/domain/modelos';
import { TETO_DO_ORCAMENTO, type Orcamento, type Tarefa } from '@/modules/ia/domain/tarefa';
import { COMITE_DA_ESTRATEGIA, GATE_DA_ESTRATEGIA, JUIZ_DA_ESTRATEGIA, PLANO_DE_ESTRATEGIA } from '@/modules/ia/domain/tarefasInternas';
import type { Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { CodigoDeErroDeIA, ErroDeIA, ExecutorDeIA, PedidoDeIA, RespostaDeIA, TarefaDeIA } from '@/modules/strategy/application/portas';

const TAREFAS_REGISTRADAS: Readonly<Record<TarefaDeIA, Tarefa<unknown>>> = {
  strategy_plan: PLANO_DE_ESTRATEGIA,
  comite: COMITE_DA_ESTRATEGIA,
  gate: GATE_DA_ESTRATEGIA,
  juiz: JUIZ_DA_ESTRATEGIA,
};

export const MARGEM_DA_CAMADA_MS = 10_000;
export const PREFIXO_DO_ATOR_DA_ESTRATEGIA = 'estrategia:';

const FALHA_DO_FORNECEDOR = 'O fornecedor de modelo não respondeu como esperado.';

const MENSAGENS_DE_TETO_DA_ORGANIZACAO: readonly string[] = Object.entries(MENSAGEM_DO_BLOQUEIO)
  .filter(([motivo]) => motivo !== 'desligada')
  .map(([, mensagem]) => mensagem);

export function codigoDeIaDaFalha(falha: Failure): CodigoDeErroDeIA {
  if (falha.code === 'unavailable' && falha.message === SEM_MODELO_CONFIGURADO.message) return 'nao_configurada';
  switch (falha.code) {
    case 'not_found':
    case 'unauthorized':
      return 'nao_configurada';
    case 'rate_limited':
      return MENSAGENS_DE_TETO_DA_ORGANIZACAO.includes(falha.message) ? 'limite_atingido' : 'falha_do_fornecedor';
    case 'forbidden':
      return falha.message === MENSAGEM_DO_BLOQUEIO.desligada ? 'limite_atingido' : 'nao_configurada';
    case 'validation':
      return 'saida_invalida';
    default:
      return 'falha_do_fornecedor';
  }
}

export function orcamentoDaCamada(orcamento: PedidoDeIA<unknown>['orcamento'], registrado: Orcamento = TETO_DO_ORCAMENTO): Orcamento {
  const dentro = (valor: number, teto: number) => Math.min(Math.max(1, Math.floor(valor)), teto);
  return {
    passos: Math.min(registrado.passos, TETO_DO_ORCAMENTO.passos),
    tokensDeSaida: dentro(orcamento.tokensMaximos, Math.min(registrado.tokensDeSaida, TETO_DO_ORCAMENTO.tokensDeSaida)),
    tempoMs: dentro(Math.max(1000, orcamento.tempoMaximoMs - MARGEM_DA_CAMADA_MS), Math.min(registrado.tempoMs, TETO_DO_ORCAMENTO.tempoMs)),
  };
}

function idDoPedido(execucaoId: string, chaveDeIdempotencia: string): string {
  return `${execucaoId.slice(0, 8)}:${createHash('sha256').update(chaveDeIdempotencia).digest('hex').slice(0, 40)}`;
}

export function criarIaDaCamada(executor: Executor): ExecutorDeIA {
  return {
    async executar<T>(pedido: PedidoDeIA<T>): Promise<Result<RespostaDeIA<T>, ErroDeIA>> {
      const registrada = TAREFAS_REGISTRADAS[pedido.tarefa];
      const requestId = idDoPedido(pedido.execucaoId, pedido.chaveDeIdempotencia);
      const resposta = await executor.executar<T>({
        organizationId: pedido.organizacaoId,
        ...(registrada.ferramentas.length === 0
          ? {}
          : {
              agente: {
                credencialId: `${PREFIXO_DO_ATOR_DA_ESTRATEGIA}${pedido.execucaoId}`,
                organizationId: pedido.organizacaoId,
                clienteIds: [pedido.clienteId],
                ferramentas: registrada.ferramentas,
                requestId,
                sourceIp: null,
                visao: 'equipe' as const,
              },
            }),
        tarefa: { ...registrada, saida: pedido.esquema, instrucao: pedido.instrucoes, orcamento: orcamentoDaCamada(pedido.orcamento, registrada.orcamento) } as Tarefa<T>,
        dados: pedido.dados,
        requestId,
      });
      if (!resposta.ok) {
        const codigo = codigoDeIaDaFalha(resposta.error);
        return err({ codigo, mensagem: codigo === 'falha_do_fornecedor' ? FALHA_DO_FORNECEDOR : resposta.error.message });
      }
      return ok({
        saida: resposta.value.saida,
        uso: { tokensDeEntrada: resposta.value.uso.tokensDeEntrada, tokensDeSaida: resposta.value.uso.tokensDeSaida },
      });
    },
  };
}
