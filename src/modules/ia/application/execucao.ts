import type { z } from 'zod';
import { failure, type Failure } from '@/shared/result/failure';
import { err, type Result } from '@/shared/result/result';
import type { EscopoDoAgente, RegistroDeFerramentas } from '../domain/ferramenta.ts';
import { dadosDelimitados, instrucaoDoSistema, type Fornecedor, type Orcamento, type Tarefa } from '../domain/tarefa.ts';

export type ModeloResolvido = {
  readonly fornecedor: Fornecedor;
  readonly modelo: string;
  readonly chave: string;
};

export type ResolvedorDeModelo = (organizationId: string, tarefa: string) => Promise<Result<ModeloResolvido, Failure>>;

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
};

export type RespostaDoModelo<S> = { readonly saida: S; readonly uso: Uso };

export type PortaDeModelo = {
  gerar<S>(pedido: PedidoAoModelo<S>): Promise<Result<RespostaDoModelo<S>, Failure>>;
};

export type RegistroDeUso = {
  readonly organizationId: string;
  readonly tarefa: string;
  readonly fornecedor: Fornecedor | null;
  readonly modelo: string | null;
  readonly resultado: 'ok' | Failure['code'];
  readonly uso: Uso;
  readonly duracaoMs: number;
  readonly requestId: string;
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
  registrarUso(registro: RegistroDeUso): Promise<void>;
  readonly avisar?: (evento: string, dados: Record<string, unknown>) => void;
  readonly relogio?: () => number;
};

export type Executor = {
  executar<S>(pedido: PedidoDeExecucao<S>): Promise<Result<RespostaDoModelo<S>, Failure>>;
};

const SEM_USO: Uso = { tokensDeEntrada: 0, tokensDeSaida: 0, passos: 0 };
const FORNECEDOR_DESLIGADO = failure('forbidden', 'O fornecedor de modelo desta tarefa não está habilitado na plataforma.');
const ESCOPO_DE_OUTRA_ORGANIZACAO = failure('forbidden', 'O escopo do agente não pertence a esta organização.');

export const SEM_MODELO_CONFIGURADO = failure(
  'unavailable',
  'Esta tarefa de IA ainda não tem fornecedor e modelo configurados para a organização.',
);

export const resolvedorSemConfiguracao: ResolvedorDeModelo = async () => err(SEM_MODELO_CONFIGURADO);

export const FALHA_GENERICA_DE_FERRAMENTA = { erro: 'A ferramenta não pôde ser executada agora.' } as const;

type Aviso = NonNullable<DependenciasDaExecucao['avisar']>;

function ferramentasDoPedido(
  tarefa: Tarefa<unknown>,
  agente: EscopoDoAgente | undefined,
  registro: RegistroDeFerramentas,
  avisar: Aviso,
): readonly FerramentaDoPedido[] {
  if (!agente || tarefa.ferramentas.length === 0) return [];
  const permitidas = agente.ferramentas.filter((nome) => tarefa.ferramentas.includes(nome));
  return registro.permitidas({ ferramentas: permitidas }).map((ferramenta) => ({
    nome: ferramenta.nome,
    descricao: ferramenta.descricao,
    entrada: ferramenta.entrada as z.ZodType<unknown>,
    async executar(entrada) {
      try {
        const resultado = await ferramenta.executar(entrada as never, agente);
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

  return {
    async executar<S>(pedido: PedidoDeExecucao<S>) {
      const inicio = agora();
      const registrar = (modelo: ModeloResolvido | null, resultado: RegistroDeUso['resultado'], uso: Uso) =>
        deps.registrarUso({
          organizationId: pedido.organizationId,
          tarefa: pedido.tarefa.chave,
          fornecedor: modelo?.fornecedor ?? null,
          modelo: modelo?.modelo ?? null,
          resultado,
          uso,
          duracaoMs: agora() - inicio,
          requestId: pedido.requestId,
        });

      if (pedido.agente && pedido.agente.organizationId !== pedido.organizationId) {
        await registrar(null, ESCOPO_DE_OUTRA_ORGANIZACAO.code, SEM_USO);
        return err(ESCOPO_DE_OUTRA_ORGANIZACAO);
      }

      const resolvido = await deps.resolver(pedido.organizationId, pedido.tarefa.chave);
      if (!resolvido.ok) {
        await registrar(null, resolvido.error.code, SEM_USO);
        return resolvido;
      }
      const modelo = resolvido.value;
      if (!deps.fornecedores.includes(modelo.fornecedor)) {
        await registrar(modelo, FORNECEDOR_DESLIGADO.code, SEM_USO);
        return err(FORNECEDOR_DESLIGADO);
      }

      const resposta = await deps.porta.gerar<S>({
        modelo,
        sistema: instrucaoDoSistema(pedido.tarefa),
        dados: dadosDelimitados(pedido.dados),
        saida: pedido.tarefa.saida,
        orcamento: pedido.tarefa.orcamento,
        ferramentas: ferramentasDoPedido(pedido.tarefa as Tarefa<unknown>, pedido.agente, deps.registro, avisar),
      });
      await registrar(modelo, resposta.ok ? 'ok' : resposta.error.code, resposta.ok ? resposta.value.uso : SEM_USO);
      return resposta;
    },
  };
}
