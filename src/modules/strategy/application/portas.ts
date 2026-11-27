import type { z } from 'zod';
import type { Result } from '@/shared/result/result';
import type { EntradaDoCatalogo } from '@/modules/brain/domain/entrada';
import type { CatalogoAtual } from '@/modules/strategy/application/catalogoAtual';
import type {
  EntradaDoPacote,
  Intencao,
  PacoteDeLeitura,
  PapelDaEvidencia,
  Plano as PlanoDeMarketing,
  Plataforma,
  StatusDaVersao,
  TipoDeEvento,
  VereditoDoLimite,
} from '@/modules/strategy/domain/index';
import type { Medida } from '@/modules/clients/domain/regras/medida';
import type { Valor } from '@/modules/clients/domain/regras/valor';

export const MAXIMO_DE_RESERVAS = 20;

export const CHAVE_DE_IDEMPOTENCIA_COM_OUTRO_PEDIDO: ErroDeEstrategia = {
  codigo: 'conflito',
  mensagem: 'Esta chave de idempotência já foi usada para um pedido diferente. Gere uma nova chave para criar outro plano.',
};

export function mesmoPedidoDePlano(existente: Pick<Plano, 'tipo' | 'plataformas' | 'landingPageId'>, novo: Pick<NovoPlano, 'tipo' | 'plataformas' | 'landingPageId'>): boolean {
  const ordenadas = (lista: readonly string[] | null) => (lista === null ? '' : [...lista].sort().join(','));
  return existente.tipo === novo.tipo && existente.landingPageId === novo.landingPageId && ordenadas(existente.plataformas) === ordenadas(novo.plataformas);
}

export type EscopoDoPlano = { readonly organizationId: string; readonly clientId: string };

export type TipoDeExecucao = 'criar' | 'ajustar' | 'revisar' | 'corrigir_gate';
export type StatusDaExecucao = 'pendente' | 'rodando' | 'concluida' | 'falhou' | 'cancelada';
export type EtapaDaExecucao = 'ler_brain' | 'redigir' | 'comite' | 'ajustar' | 'gates' | 'fim';
export type CodigoDeErroDaExecucao =
  | 'ia_nao_configurada'
  | 'ia_limite'
  | 'ia_saida_invalida'
  | 'ia_falha'
  | 'ia_tempo'
  | 'brain_indisponivel'
  | 'gate_reprovado'
  | 'correcao_nao_convergiu'
  | 'interno';

export type MotivoDeRevisao = 'edicao_manual' | 'brain_mudou';

export type PedidoDaExecucao =
  | { readonly tipo: 'criar'; readonly intencao: Intencao }
  | { readonly tipo: 'ajustar'; readonly instrucao: string }
  | { readonly tipo: 'revisar'; readonly motivo: MotivoDeRevisao }
  | { readonly tipo: 'corrigir_gate' };

export type CodigoDeErroDeEstrategia =
  | 'sem_permissao'
  | 'falta_para_aplicar'
  | 'ja_feito'
  | 'teto_do_agente'
  | 'conflito'
  | 'transicao_invalida'
  | 'execucao_ativa'
  | 'execucao_perdida'
  | 'nao_encontrado'
  | 'invalido';

export type ErroDeEstrategia = {
  readonly codigo: CodigoDeErroDeEstrategia;
  readonly mensagem: string;
  readonly teto?: 'execucao' | 'dia';
};

export type Plano = {
  readonly id: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly tipo: string;
  readonly plataformas: readonly Plataforma[] | null;
  readonly whatsapp: string | null;
  readonly landingPageId: string | null;
  readonly criadoEm: Date;
};

export type NovoPlano = {
  readonly tipo: string;
  readonly plataformas: readonly Plataforma[];
  readonly whatsapp: string;
  readonly landingPageId: string;
  readonly chaveDeIdempotencia?: string;
};

export type AutorDaVersao = 'usuario' | 'agente';

export type VersaoResumo = {
  readonly id: string;
  readonly planoId: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly status: StatusDaVersao;
  readonly schemaVersion: number;
  readonly supersedesId: string | null;
  readonly autorTipo: AutorDaVersao;
  readonly autorUsuarioId: string | null;
  readonly agentId: string | null;
  readonly agentRunId: string | null;
  readonly redigidaEm: Date | null;
  readonly criadaEm: Date;
};

export type ReferenciaDaVersao = {
  readonly urn: string;
  readonly hash: string;
  readonly papel: PapelDaEvidencia;
};

export type Versao = VersaoResumo & {
  readonly conteudo: unknown;
  readonly referencias: readonly ReferenciaDaVersao[];
};

export type PlanoDoCliente = {
  readonly plano: Plano;
  readonly maisRecente: VersaoResumo | null;
  readonly vigente: VersaoResumo | null;
  readonly aberta: VersaoResumo | null;
  readonly objetivo: string | null;
  readonly ultimaExecucao: Execucao | null;
  readonly atualizadoEm: Date;
};

export type TipoDeEventoRegistravel = Extract<
  TipoDeEvento,
  'proposta' | 'parecer' | 'ajuste' | 'gate' | 'veredito_juiz' | 'cancelada' | 'efetivada' | 'rejeitada' | 'revogada'
>;

export type EventoDaVersao = {
  readonly id: string;
  readonly versaoId: string;
  readonly tipo: TipoDeEvento;
  readonly atorTipo: 'usuario' | 'agente' | 'sistema';
  readonly atorUsuarioId: string | null;
  readonly agentId: string | null;
  readonly agentRunId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly criadoEm: Date;
};

export type AutoriaDePessoa = { readonly tipo: 'pessoa'; readonly userId: string };
export type AutoriaDeAgente = {
  readonly tipo: 'agente';
  readonly agentId: string;
  readonly agentRunId: string;
  readonly chaveDeIdempotencia: string;
  readonly ficha: number;
};
export type Autoria = AutoriaDePessoa | AutoriaDeAgente;

export type EventoInicial = {
  readonly tipo: TipoDeEventoRegistravel;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly autoria: AutoriaDeAgente;
};

export type NovaVersao = {
  readonly planoId: string;
  readonly conteudo: unknown;
  readonly schemaVersion: number;
  readonly supersedesId: string | null;
  readonly autoria: Autoria;
  readonly referencias: readonly ReferenciaDaVersao[];
  readonly eventosIniciais?: readonly EventoInicial[];
  readonly requestId: string;
};

export type NovoEvento = {
  readonly versaoId: string;
  readonly tipo: TipoDeEventoRegistravel;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly autoria: Autoria;
  readonly requestId: string;
};

export type Execucao = {
  readonly id: string;
  readonly planoId: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly tipo: TipoDeExecucao;
  readonly pedido: Readonly<Record<string, unknown>>;
  readonly versaoBaseId: string | null;
  readonly status: StatusDaExecucao;
  readonly etapa: EtapaDaExecucao;
  readonly rodada: number;
  readonly tentativas: number;
  readonly falhas: number;
  readonly erroCodigo: CodigoDeErroDaExecucao | null;
  readonly agentRunId: string;
  readonly solicitadoPor: string | null;
  readonly solicitadoTipo: 'usuario' | 'sistema';
  readonly leaseAte: Date | null;
  readonly criadaEm: Date;
  readonly atualizadaEm: Date;
};

export type NovaExecucao = {
  readonly planoId: string;
  readonly pedido: PedidoDaExecucao;
  readonly versaoBaseId: string | null;
  readonly agentRunId: string;
  readonly solicitadoPor: string;
  readonly requestId: string;
};

export type MudancaDaExecucao = {
  readonly status?: StatusDaExecucao;
  readonly etapa?: EtapaDaExecucao;
  readonly rodada?: number;
  readonly tentativas?: number;
  readonly falhas?: number;
  readonly erroCodigo?: CodigoDeErroDaExecucao | null;
  readonly leaseAte?: Date | null;
};

export type ExecucaoPendente = { readonly organizationId: string; readonly clientId: string; readonly id: string };

export type EdicaoManualGravada = { readonly versao: Versao; readonly execucao: Execucao };

export type OpcoesDeReserva = { readonly leaseMs: number; readonly agora: Date };

export type TipoDeRecurso = 'plano' | 'versao' | 'execucao';

export type RepositorioDeEstrategia = {
  clienteVisivel(organizationId: string, clientId: string): Promise<boolean>;
  buscarPlanoPorId(organizationId: string, planoId: string): Promise<Plano | null>;
  clienteDoRecurso(organizationId: string, tipo: TipoDeRecurso, id: string): Promise<string | null>;
  criarPlanoComExecucao(
    escopo: EscopoDoPlano,
    novo: NovoPlano,
    execucao: Omit<NovaExecucao, 'planoId'>,
  ): Promise<Result<{ readonly plano: Plano; readonly execucao: Execucao; readonly reaproveitado?: boolean }, ErroDeEstrategia>>;
  listarPlanosDoCliente(escopo: EscopoDoPlano): Promise<readonly PlanoDoCliente[]>;
  estadoDoPlano(organizationId: string, planoId: string): Promise<PlanoDoCliente | null>;
  criarVersaoRascunho(organizationId: string, nova: NovaVersao): Promise<Result<Versao, ErroDeEstrategia>>;
  registrarEvento(organizationId: string, novo: NovoEvento): Promise<Result<EventoDaVersao, ErroDeEstrategia>>;
  lerVersao(organizationId: string, versaoId: string): Promise<Versao | null>;
  listarVersoes(organizationId: string, planoId: string, limite: number): Promise<readonly VersaoResumo[]>;
  eventosDaVersao(organizationId: string, versaoId: string): Promise<readonly EventoDaVersao[]>;
  criarExecucao(organizationId: string, clientId: string, nova: NovaExecucao): Promise<Result<Execucao, ErroDeEstrategia>>;
  lerExecucao(organizationId: string, execucaoId: string): Promise<Execucao | null>;
  execucaoAtiva(organizationId: string, planoId: string): Promise<Execucao | null>;
  execucoesDoPlano(organizationId: string, planoId: string, limite: number): Promise<readonly Execucao[]>;
  ultimaExecucao(organizationId: string, planoId: string): Promise<Execucao | null>;
  cancelarExecucao(organizationId: string, execucaoId: string, requestId: string): Promise<Result<Execucao, ErroDeEstrategia>>;
  atualizarExecucao(
    organizationId: string,
    execucaoId: string,
    mudanca: MudancaDaExecucao,
    ficha: number,
  ): Promise<Result<Execucao, ErroDeEstrategia>>;
  criarVersaoManualComRevisao(
    organizationId: string,
    clientId: string,
    versao: NovaVersao,
    execucao: Omit<NovaExecucao, 'versaoBaseId'>,
  ): Promise<Result<EdicaoManualGravada, ErroDeEstrategia>>;
  reservarProximaExecucao(organizationId: string, opcoes: OpcoesDeReserva): Promise<Execucao | null>;
  reservarExecucao(organizationId: string, execucaoId: string, opcoes: OpcoesDeReserva): Promise<Execucao | null>;
  descobrirExecucoesPendentes(limite: number): Promise<readonly ExecucaoPendente[]>;
};

export type CodigoDeErroDeIA = 'nao_configurada' | 'limite_atingido' | 'saida_invalida' | 'falha_do_fornecedor' | 'tempo_esgotado';

export type ErroDeIA = { readonly codigo: CodigoDeErroDeIA; readonly mensagem: string };

export type TarefaDeIA = 'strategy_plan' | 'comite' | 'juiz' | 'gate';

export type PedidoDeIA<T> = {
  readonly tarefa: TarefaDeIA;
  readonly instrucoes: string;
  readonly dados: unknown;
  readonly esquema: z.ZodType<T>;
  readonly orcamento: { readonly tokensMaximos: number; readonly tempoMaximoMs: number };
  readonly organizacaoId: string;
  readonly clienteId: string;
  readonly execucaoId: string;
  readonly chaveDeIdempotencia: string;
  readonly sinal?: AbortSignal;
};

export type UsoDeIA = { readonly tokensDeEntrada: number; readonly tokensDeSaida: number; readonly modelo?: string };

export type RespostaDeIA<T> = { readonly saida: T; readonly uso: UsoDeIA };

export type ExecutorDeIA = {
  executar<T>(pedido: PedidoDeIA<T>): Promise<Result<RespostaDeIA<T>, ErroDeIA>>;
};

export type ErroDoBrain = { readonly codigo: 'brain_indisponivel' | 'cliente_inexistente'; readonly mensagem: string };

export type SnapshotDoBrainLido = {
  readonly organizationId: string;
  readonly clienteId: string;
  readonly entradas: readonly EntradaDoCatalogo[];
};

export type LeitorDoBrain = {
  lerPacote(organizacaoId: string, clienteId: string): Promise<Result<PacoteDeLeitura, ErroDoBrain>>;
  entradasPorUrn?(organizacaoId: string, clienteId: string, urns: readonly string[]): Promise<Result<EntradaDoPacote[], ErroDoBrain>>;
  catalogoDoSnapshot?(organizacaoId: string, clienteId: string, snapshot: SnapshotDoBrainLido): CatalogoAtual | null;
};

export type AvaliarLimite = ((medida: Medida, valor: Valor) => VereditoDoLimite) & {
  readonly medidasComLimite: readonly Medida[];
};

export type ErroDeLimites = { readonly codigo: 'limites_indisponiveis'; readonly mensagem: string };

export type AvaliadorDeLimites = {
  avaliador(organizacaoId: string, clienteId: string, plano: PlanoDeMarketing): Promise<Result<AvaliarLimite, ErroDeLimites>>;
};

export type TipoDeLimiteDisponivel = {
  readonly key: string;
  readonly medida: string;
  readonly periodo: string;
  readonly sentido: string;
  readonly unidade: string;
};

export type CatalogoDeLimites = {
  listar(organizationId: string): Promise<readonly TipoDeLimiteDisponivel[]>;
};

export type Relogio = { agora(): Date };

export type GeradorDeId = { novo(): string };
