import type { Result } from '@/shared/result/result';
import type { ErroDeEstrategia } from '@/modules/strategy/application/portas';

export const STATUS_DO_PLANO_DE_PRODUCAO = ['pendente', 'pronto', 'falhou'] as const;
export type StatusDoPlanoDeProducao = (typeof STATUS_DO_PLANO_DE_PRODUCAO)[number];

export const CODIGOS_DE_ERRO_DA_PRODUCAO = [
  'ia_nao_configurada',
  'ia_limite',
  'ia_saida_invalida',
  'ia_falha',
  'ia_tempo',
  'brain_indisponivel',
  'conferencia_reprovada',
  'plano_fora_do_estado',
  'plano_sem_campanhas',
  'interno',
] as const;
export type CodigoDeErroDaProducao = (typeof CODIGOS_DE_ERRO_DA_PRODUCAO)[number];

export const MAXIMO_DE_RESERVAS_DA_PRODUCAO = 40;

export type RegistroDeProducao = {
  readonly id: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly planoId: string;
  readonly versaoId: string;
  readonly numero: number;
  readonly status: StatusDoPlanoDeProducao;
  readonly conteudo: unknown;
  readonly progresso: Readonly<Record<string, unknown>>;
  readonly erroCodigo: CodigoDeErroDaProducao | null;
  readonly motivo: string | null;
  readonly tentativas: number;
  readonly falhas: number;
  readonly leaseAte: Date | null;
  readonly agentRunId: string;
  readonly solicitadoPor: string | null;
  readonly criadoEm: Date;
  readonly atualizadoEm: Date;
  readonly concluidoEm: Date | null;
  readonly redigidoEm: Date | null;
};

export type NovoPedidoDeProducao = {
  readonly clientId: string;
  readonly planoId: string;
  readonly versaoId: string;
  readonly agentRunId: string;
  readonly solicitadoPor: string;
  readonly requestId: string;
};

export type MudancaDaProducao = {
  readonly status?: StatusDoPlanoDeProducao;
  readonly conteudo?: unknown;
  readonly progresso?: Readonly<Record<string, unknown>>;
  readonly erroCodigo?: CodigoDeErroDaProducao;
  readonly motivo?: string | null;
  readonly falhas?: number;
  readonly leaseAte?: Date | null;
};

export type ProducaoPendente = { readonly organizationId: string; readonly clientId: string; readonly id: string };

export type RepositorioDeProducao = {
  pedir(organizationId: string, novo: NovoPedidoDeProducao): Promise<Result<RegistroDeProducao, ErroDeEstrategia>>;
  listarDoPlano(organizationId: string, planoId: string, limite: number): Promise<readonly RegistroDeProducao[]>;
  ler(organizationId: string, id: string): Promise<RegistroDeProducao | null>;
  descobrirPendentes(limite: number): Promise<readonly ProducaoPendente[]>;
  reservar(organizationId: string, id: string, leaseMs: number): Promise<RegistroDeProducao | null>;
  atualizar(organizationId: string, id: string, ficha: number, mudanca: MudancaDaProducao): Promise<Result<RegistroDeProducao, ErroDeEstrategia>>;
};
