import type { z } from 'zod';
import { failure, type Failure } from '@/shared/result/failure';
import { err, type Result } from '@/shared/result/result';
import { executarFerramenta, type EscopoDoAgente, type RegistroDeFerramentas } from '../domain/ferramenta.ts';
import { dadosDelimitados, instrucaoDoSistema, type Fornecedor, type Orcamento, type Raciocinio, type Tarefa } from '../domain/tarefa.ts';

export type ModeloResolvido = {
  readonly fornecedor: Fornecedor;
  readonly modelo: string;
  readonly chave: string;
};

export type ModeloEscolhido = {
  readonly fornecedor: Fornecedor;
  readonly modelo: string;
  abrirChave(): Promise<Result<string, Failure>>;
};

export type ResolvedorDeModelo = (organizationId: string, tarefa: string) => Promise<Result<ModeloEscolhido, Failure>>;

export type Uso = {
  readonly tokensDeEntrada: number;
  readonly tokensDeSaida: number;
  readonly passos: number;
};

export type FerramentaDoPedido = {
  readonly nome: string;
  readonly descricao: string;
  readonly entrada: z.ZodType<unknown>;
  executar(entrada: unknown): Promise<unknown>;
};

export type PedidoAoModelo<S> = {
  readonly modelo: ModeloResolvido;
  readonly sistema: string;
  readonly dados: string;
  readonly saida: z.ZodType<S>;
  readonly orcamento: Orcamento;
  readonly ferramentas: readonly FerramentaDoPedido[];
  readonly raciocinio?: Raciocinio;
};

export type RespostaDoModelo<S> = { readonly saida: S; readonly uso: Uso };

export type PortaDeModelo = {
  gerar<S>(pedido: PedidoAoModelo<S>): Promise<Result<RespostaDoModelo<S>, Failure>>;
};

export type Reserva = {
  readonly organizationId: string;
  readonly tarefa: string;
  readonly fornecedor: Fornecedor;
  readonly modelo: string;
  readonly tokensReservados: number;
  readonly requestId: string;
};

export type Desfecho = {
  readonly resultado: 'ok' | Failure['code'];
  readonly uso: Uso;
  readonly duracaoMs: number;
};

export type LivroDeUso = {
  reservar(reserva: Reserva): Promise<Result<string, Failure>>;
  concluir(organizationId: string, reservaId: string, desfecho: Desfecho): Promise<void>;
};

export type PedidoDeExecucao<S> = {
  readonly organizationId: string;
  readonly tarefa: Tarefa<S>;
  readonly dados: unknown;
  readonly requestId: string;
  readonly agente?: EscopoDoAgente;
};

export type DependenciasDaExecucao = {
  readonly resolver: ResolvedorDeModelo;
  readonly porta: PortaDeModelo;
  readonly registro: RegistroDeFerramentas;
  readonly fornecedores: readonly Fornecedor[];
  readonly livro: LivroDeUso;
  readonly avisar?: (evento: string, dados: Record<string, unknown>) => void;
  readonly relogio?: () => number;
};

export type Executor = {
  executar<S>(pedido: PedidoDeExecucao<S>): Promise<Result<RespostaDoModelo<S>, Failure>>;
};

const SEM_USO: Uso = { tokensDeEntrada: 0, tokensDeSaida: 0, passos: 0 };
const FORNECEDOR_DESLIGADO = failure('forbidden', 'O fornecedor de modelo desta tarefa não está habilitado na plataforma.');
const CHAVE_NAO_ABRIU = failure('unavailable', 'A chave do fornecedor não pôde ser aberta agora.');
const ESCOPO_DE_OUTRA_ORGANIZACAO = failure('forbidden', 'O escopo do agente não pertence a esta organização.');

export const SEM_MODELO_CONFIGURADO = failure(
  'unavailable',
  'Esta tarefa de IA ainda não tem fornecedor e modelo configurados para a organização.',
);

export const FALHA_GENERICA_DE_FERRAMENTA = { erro: 'A ferramenta não pôde ser executada agora.' } as const;

type Aviso = NonNullable<DependenciasDaExecucao['avisar']>;

export function tokensReservados(orcamento: Orcamento): number {
  return orcamento.tokensDeSaida * orcamento.passos;
}

export const LIMITE_DE_CHAMADAS_DE_FERRAMENTA_POR_PEDIDO = 10;
const LIMITE_DE_FERRAMENTA_ATINGIDO = { erro: 'Limite de consultas deste pedido atingido: responda com o que já foi lido e declare a falta.' };

function ferramentasDoPedido(
  tarefa: Tarefa<unknown>,
  agente: EscopoDoAgente | undefined,
  registro: RegistroDeFerramentas,
  avisar: Aviso,
): readonly FerramentaDoPedido[] {
  if (!agente || tarefa.ferramentas.length === 0) return [];
  const permitidas = agente.ferramentas.filter((nome) => tarefa.ferramentas.includes(nome));
  let chamadas = 0;
  return registro.permitidas({ ferramentas: permitidas }).map((ferramenta) => ({
    nome: ferramenta.nome,
    descricao: ferramenta.descricao,
    entrada: ferramenta.entrada as z.ZodType<unknown>,
    async executar(entrada) {
      chamadas += 1;
      if (chamadas > LIMITE_DE_CHAMADAS_DE_FERRAMENTA_POR_PEDIDO) return LIMITE_DE_FERRAMENTA_ATINGIDO;
      try {
        const resultado = await executarFerramenta(ferramenta, entrada, agente);
        return resultado.ok ? resultado.value : { erro: resultado.error.message };
      } catch (erro) {
        avisar('ia.execucao.ferramenta_falhou', {
          ferramenta: ferramenta.nome,
          requestId: agente.requestId,
          erro: erro instanceof Error ? erro.name : 'desconhecido',
        });
        return FALHA_GENERICA_DE_FERRAMENTA;
      }
    },
  }));
}

export function createExecutor(deps: DependenciasDaExecucao): Executor {
  const agora = deps.relogio ?? (() => Date.now());
  const avisar: Aviso = deps.avisar ?? (() => undefined);

  async function concluir(organizationId: string, reservaId: string, desfecho: Desfecho, requestId: string): Promise<void> {
    try {
      await deps.livro.concluir(organizationId, reservaId, desfecho);
    } catch (erro) {
      avisar('ia.execucao.uso_nao_registrado', { requestId, erro: erro instanceof Error ? erro.name : 'desconhecido' });
    }
  }

  return {
    async executar<S>(pedido: PedidoDeExecucao<S>) {
      const inicio = agora();
      if (pedido.agente && pedido.agente.organizationId !== pedido.organizationId) return err(ESCOPO_DE_OUTRA_ORGANIZACAO);

      const escolhido = await deps.resolver(pedido.organizationId, pedido.tarefa.chave);
      if (!escolhido.ok) return escolhido;
      const { fornecedor, modelo } = escolhido.value;
      if (!deps.fornecedores.includes(fornecedor)) return err(FORNECEDOR_DESLIGADO);

      const reserva = await deps.livro.reservar({
        organizationId: pedido.organizationId,
        tarefa: pedido.tarefa.chave,
        fornecedor,
        modelo,
        tokensReservados: tokensReservados(pedido.tarefa.orcamento),
        requestId: pedido.requestId,
      });
      if (!reserva.ok) return reserva;
      const fechar = (resultado: Desfecho['resultado'], uso: Uso) =>
        concluir(pedido.organizationId, reserva.value, { resultado, uso, duracaoMs: agora() - inicio }, pedido.requestId);

      const chave = await escolhido.value.abrirChave().catch((erro: unknown): Result<string, Failure> => {
        avisar('ia.execucao.chave_nao_abriu', { requestId: pedido.requestId, erro: erro instanceof Error ? erro.name : 'desconhecido' });
        return err(CHAVE_NAO_ABRIU);
      });
      if (!chave.ok) {
        await fechar(chave.error.code, SEM_USO);
        return chave;
      }

      const resposta = await deps.porta.gerar<S>({
        modelo: { fornecedor, modelo, chave: chave.value },
        sistema: instrucaoDoSistema(pedido.tarefa),
        dados: dadosDelimitados(pedido.dados),
        saida: pedido.tarefa.saida,
        orcamento: pedido.tarefa.orcamento,
        raciocinio: pedido.tarefa.raciocinio,
        ferramentas: ferramentasDoPedido(pedido.tarefa as Tarefa<unknown>, pedido.agente, deps.registro, avisar),
      });
      await fechar(resposta.ok ? 'ok' : resposta.error.code, resposta.ok ? resposta.value.uso : SEM_USO);
      return resposta;
    },
  };
}
