import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { registrarSemFalhar } from '@/modules/audit/application/registrarSemFalhar';
import type { Ator } from '@/modules/audit/domain/actor';
import type { MemberRole } from '@/modules/identity/domain/user';
import { podeExecutar } from '@/modules/strategy/domain/papeis';
import { lerPlano, type Plano as PlanoDeMarketing } from '@/modules/strategy/domain/plano';
import { esquemaPlanoDeProducao, type PlanoDeProducao } from '@/modules/strategy/domain/producao/planoDeProducao';
import type { ErroDeEstrategia, GeradorDeId, Plano, RepositorioDeEstrategia, VersaoResumo } from '@/modules/strategy/application/portas';
import type { RegistroDeProducao, RepositorioDeProducao } from '@/modules/strategy/application/portasDaProducao';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';

export const LIMITE_DE_GERACOES_LISTADAS = 10;

export const AvancarProducaoSchema = z.strictObject({ limite: z.number().int().min(1).max(20).default(5) });

export type ComandoDeProducao = { readonly organizationId: string; readonly papelDeQuemAge: MemberRole };

const IDENTIFICADOR = z.string().uuid();
const EscopoDoPlanoSchema = z.strictObject({ clienteId: IDENTIFICADOR, planoId: IDENTIFICADOR });
const EscopoDaGeracaoSchema = z.strictObject({ clienteId: IDENTIFICADOR, planoId: IDENTIFICADOR, producaoId: IDENTIFICADOR });
export type EntradaDoPlanoDeProducao = z.input<typeof EscopoDoPlanoSchema>;
export type EntradaDaGeracao = z.input<typeof EscopoDaGeracaoSchema>;

const SEM_PERMISSAO = failure('forbidden', 'Seu papel não permite esta ação sobre o plano.');
const SEM_USUARIO = failure('unauthorized', 'Sessão sem usuário.');
const PLANO_NAO_ENCONTRADO = failure('not_found', 'Plano não encontrado.');
const GERACAO_NAO_ENCONTRADA = failure('not_found', 'Plano de produção não encontrado.');
const SEM_VERSAO_AUTORIZADA = failure('conflict', 'O plano de produção só nasce de um plano autorizado. Autorize o plano e tente de novo.');
const ENTRADA_INVALIDA = failure('validation', 'Pedido inválido.');

export type GeracaoDeProducao = {
  readonly registro: RegistroDeProducao;
  readonly conteudo: PlanoDeProducao | null;
};

export type PainelDeProducao = {
  readonly plano: Plano;
  readonly vigente: VersaoResumo | null;
  readonly planoDeMarketing: PlanoDeMarketing | null;
  readonly geracoes: readonly GeracaoDeProducao[];
};

export type PlanoDeProducaoService = {
  pedir(comando: ComandoDeProducao, entrada: EntradaDoPlanoDeProducao, ator: Ator): Promise<Result<RegistroDeProducao, Failure>>;
  painel(comando: ComandoDeProducao, entrada: EntradaDoPlanoDeProducao): Promise<Result<PainelDeProducao, Failure>>;
  geracao(comando: ComandoDeProducao, entrada: EntradaDaGeracao): Promise<Result<GeracaoDeProducao & { readonly plano: Plano; readonly planoDeMarketing: PlanoDeMarketing | null }, Failure>>;
};

export type DependenciasDoServicoDeProducao = {
  readonly repositorio: RepositorioDeProducao;
  readonly estrategia: Pick<RepositorioDeEstrategia, 'buscarPlanoPorId' | 'estadoDoPlano' | 'lerVersao'>;
  readonly audit: AuditRecorder;
  readonly gerador?: GeradorDeId;
};

function falhaDoRepositorio(erro: ErroDeEstrategia): Failure {
  switch (erro.codigo) {
    case 'execucao_ativa':
      return failure('conflict', 'Já há um plano de produção sendo gerado para este plano. Aguarde terminar.');
    case 'sem_permissao':
      return SEM_PERMISSAO;
    case 'nao_encontrado':
      return PLANO_NAO_ENCONTRADO;
    case 'conflito':
    case 'transicao_invalida':
      return SEM_VERSAO_AUTORIZADA;
    default:
      return failure('conflict', 'Não foi possível pedir o plano de produção agora.');
  }
}

function conteudoLido(registro: RegistroDeProducao): PlanoDeProducao | null {
  if (registro.status !== 'pronto' || registro.redigidoEm !== null) return null;
  const lido = esquemaPlanoDeProducao.safeParse(registro.conteudo);
  return lido.success ? lido.data : null;
}

export function createPlanoDeProducaoService(deps: DependenciasDoServicoDeProducao): PlanoDeProducaoService {
  const gerador = deps.gerador ?? { novo: () => randomUUID() };
  const podeLer = (papel: MemberRole) => podeExecutar('ler', { tipo: 'pessoa', papel });
  const podePedir = (papel: MemberRole) => podeExecutar('criar', { tipo: 'pessoa', papel });

  async function planoDoCliente(comando: ComandoDeProducao, clienteId: string, planoId: string): Promise<Plano | null> {
    const plano = await deps.estrategia.buscarPlanoPorId(comando.organizationId, planoId);
    return plano !== null && plano.clientId === clienteId && plano.organizationId === comando.organizationId ? plano : null;
  }

  async function planoDeMarketingDe(comando: ComandoDeProducao, versao: VersaoResumo | null): Promise<PlanoDeMarketing | null> {
    if (versao === null || versao.redigidaEm !== null) return null;
    const completa = await deps.estrategia.lerVersao(comando.organizationId, versao.id);
    if (completa === null) return null;
    const lido = lerPlano(completa.conteudo);
    return lido.ok ? lido.value : null;
  }

  return {
    async pedir(comando, entrada, ator) {
      const lida = EscopoDoPlanoSchema.safeParse(entrada);
      if (!lida.success) return err(ENTRADA_INVALIDA);
      if (!podePedir(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      if (ator.userId === null) return err(SEM_USUARIO);
      const plano = await planoDoCliente(comando, lida.data.clienteId, lida.data.planoId);
      if (plano === null) return err(PLANO_NAO_ENCONTRADO);
      const estado = await deps.estrategia.estadoDoPlano(comando.organizationId, plano.id);
      const vigente = estado?.vigente ?? null;
      if (vigente === null || vigente.redigidaEm !== null) return err(SEM_VERSAO_AUTORIZADA);
      const pedido = await deps.repositorio.pedir(comando.organizationId, {
        clientId: plano.clientId,
        planoId: plano.id,
        versaoId: vigente.id,
        agentRunId: `producao-${gerador.novo()}`,
        solicitadoPor: ator.userId,
        requestId: ator.requestId,
      });
      if (!pedido.ok) return err(falhaDoRepositorio(pedido.error));
      await registrarSemFalhar(deps.audit, {
        organizationId: comando.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'strategy.production.requested',
        targetType: 'strategy_production_plan',
        targetId: pedido.value.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { clientId: plano.clientId, planoId: plano.id, versaoId: vigente.id, numero: pedido.value.numero },
      });
      return ok(pedido.value);
    },

    async painel(comando, entrada) {
      const lida = EscopoDoPlanoSchema.safeParse(entrada);
      if (!lida.success) return err(ENTRADA_INVALIDA);
      if (!podeLer(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const plano = await planoDoCliente(comando, lida.data.clienteId, lida.data.planoId);
      if (plano === null) return err(PLANO_NAO_ENCONTRADO);
      const [estado, registros] = await Promise.all([
        deps.estrategia.estadoDoPlano(comando.organizationId, plano.id),
        deps.repositorio.listarDoPlano(comando.organizationId, plano.id, LIMITE_DE_GERACOES_LISTADAS),
      ]);
      const vigente = estado?.vigente ?? null;
      return ok({
        plano,
        vigente,
        planoDeMarketing: await planoDeMarketingDe(comando, vigente),
        geracoes: registros.filter((registro) => registro.clientId === plano.clientId).map((registro) => ({ registro, conteudo: conteudoLido(registro) })),
      });
    },

    async geracao(comando, entrada) {
      const lida = EscopoDaGeracaoSchema.safeParse(entrada);
      if (!lida.success) return err(ENTRADA_INVALIDA);
      if (!podeLer(comando.papelDeQuemAge)) return err(SEM_PERMISSAO);
      const plano = await planoDoCliente(comando, lida.data.clienteId, lida.data.planoId);
      if (plano === null) return err(PLANO_NAO_ENCONTRADO);
      const registro = await deps.repositorio.ler(comando.organizationId, lida.data.producaoId);
      if (registro === null || registro.planoId !== plano.id || registro.clientId !== plano.clientId) return err(GERACAO_NAO_ENCONTRADA);
      const versao = await deps.estrategia.lerVersao(comando.organizationId, registro.versaoId);
      const planoDeMarketing = versao === null || versao.redigidaEm !== null ? null : (() => {
        const lido = lerPlano(versao.conteudo);
        return lido.ok ? lido.value : null;
      })();
      return ok({ registro, conteudo: conteudoLido(registro), plano, planoDeMarketing });
    },
  };
}
