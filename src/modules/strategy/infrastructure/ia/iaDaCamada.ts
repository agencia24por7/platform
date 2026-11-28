import { createHash } from 'node:crypto';
import { SEM_MODELO_CONFIGURADO, type Executor } from '@/modules/ia/application/execucao';
import { MENSAGEM_DO_BLOQUEIO } from '@/modules/ia/domain/modelos';
import { TETO_DO_ORCAMENTO, TETO_ELASTICO_DE_SAIDA, prefixoEstavelDosDados, type Orcamento, type Tarefa } from '@/modules/ia/domain/tarefa';
import { COMITE_DA_ESTRATEGIA, DIRETOR_DE_PRODUCAO, GATE_DA_ESTRATEGIA, JUIZ_DA_ESTRATEGIA, PLANO_DE_ESTRATEGIA, TAREFAS_DOS_COMITES } from '@/modules/ia/domain/tarefasInternas';
import type { Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { CodigoDeErroDeIA, ErroDeIA, ExecutorDeIA, PedidoDeIA, RespostaDeIA, TarefaDeIA, TelemetriaDeIA } from '@/modules/strategy/application/portas';

export const TAREFAS_REGISTRADAS: ReadonlyMap<TarefaDeIA, Tarefa<unknown>> = new Map<TarefaDeIA, Tarefa<unknown>>([
  ['strategy_plan', PLANO_DE_ESTRATEGIA],
  ['comite', COMITE_DA_ESTRATEGIA],
  ['gate', GATE_DA_ESTRATEGIA],
  ['juiz', JUIZ_DA_ESTRATEGIA],
  ['diretor_de_producao', DIRETOR_DE_PRODUCAO],
  ...TAREFAS_DOS_COMITES.map((tarefa) => [tarefa.chave as TarefaDeIA, tarefa as Tarefa<unknown>] as const),
]);

const TAREFA_NAO_REGISTRADA: ErroDeIA = { codigo: 'nao_configurada', mensagem: 'Tarefa de IA não registrada na camada.' };

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
    tokensDeSaida: dentro(orcamento.tokensMaximos, orcamento.elastico === true ? TETO_ELASTICO_DE_SAIDA : Math.min(registrado.tokensDeSaida, TETO_DO_ORCAMENTO.tokensDeSaida)),
    tempoMs: dentro(Math.max(1000, orcamento.tempoMaximoMs - MARGEM_DA_CAMADA_MS), Math.min(registrado.tempoMs, TETO_DO_ORCAMENTO.tempoMs)),
  };
}

function idDoPedido(execucaoId: string, chaveDeIdempotencia: string): string {
  return `${execucaoId.slice(0, 8)}:${createHash('sha256').update(chaveDeIdempotencia).digest('hex').slice(0, 40)}`;
}

const CAMINHOS_CONHECIDOS = ['estruturado', 'estruturado_relaxado', 'json_livre'];
const RECUSAS_CONHECIDAS = ['schema', 'constraint', 'too many states'];

export function telemetriaDosDetalhes(detalhes: Readonly<Record<string, string>> | undefined): TelemetriaDeIA | undefined {
  if (!detalhes || !CAMINHOS_CONHECIDOS.includes(detalhes['caminho'] ?? '')) return undefined;
  const recusa = detalhes['recusaDoEsquema'];
  return {
    caminho: detalhes['caminho']!,
    finishReason: (detalhes['finishReason'] ?? 'desconhecido').replace(/[^a-z_-]/gi, '').slice(0, 30),
    tokensDeSaida: Number(detalhes['tokensDeSaida']) || 0,
    tetoDeSaida: Number(detalhes['tetoDeSaida']) || 0,
    ...(recusa !== undefined && RECUSAS_CONHECIDAS.includes(recusa) ? { recusaDoEsquema: recusa } : {}),
  };
}

export function criarIaDaCamada(executor: Executor): ExecutorDeIA {
  return {
    prefixoEstavel: prefixoEstavelDosDados,
    async executar<T>(pedido: PedidoDeIA<T>): Promise<Result<RespostaDeIA<T>, ErroDeIA>> {
      const registrada = TAREFAS_REGISTRADAS.get(pedido.tarefa);
      if (registrada === undefined) return err(TAREFA_NAO_REGISTRADA);
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
        ...(pedido.instrucaoFinal === undefined ? {} : { instrucaoFinal: pedido.instrucaoFinal }),
        ...(pedido.prefixoEstavelDosDados === undefined ? {} : { prefixoEstavelDosDados: pedido.prefixoEstavelDosDados }),
      });
      if (!resposta.ok) {
        const codigo = codigoDeIaDaFalha(resposta.error);
        const telemetria = telemetriaDosDetalhes(resposta.error.details);
        return err({ codigo, mensagem: codigo === 'falha_do_fornecedor' ? FALHA_DO_FORNECEDOR : resposta.error.message, ...(telemetria === undefined ? {} : { telemetria }) });
      }
      return ok({
        saida: resposta.value.saida,
        uso: { tokensDeEntrada: resposta.value.uso.tokensDeEntrada, tokensDeEntradaEmCache: resposta.value.uso.tokensDeEntradaEmCache, tokensDeSaida: resposta.value.uso.tokensDeSaida },
        ...(resposta.value.telemetria === undefined ? {} : { telemetria: resposta.value.telemetria }),
      });
    },
  };
}
