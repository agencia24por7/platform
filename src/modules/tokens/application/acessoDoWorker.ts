import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { Platform } from '@/modules/connections/domain/connection';
import type { WorkerContext } from '@/shared/http/workerRoute';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { FormaDoAcesso } from '@/modules/tokens/domain/token';
import type { CofreDeTokens, FalhaDoCofre, ResumoDaVarredura } from '@/modules/tokens/application/cofreDeTokens';

export type OrigemDoToken = { readonly coletaId: string } | { readonly tarefaId: string };

export type ContextoDaOrigem = {
  readonly organizationId: string;
  readonly connectionId: string;
  readonly platform: Platform;
  readonly connectionStatus: string;
  readonly origemEmExecucao: boolean;
  readonly fonteAtiva: boolean;
  readonly tenantAtivo: boolean;
  readonly temToken: boolean;
};

export type ResolvedorDeOrigem = {
  resolver(origem: OrigemDoToken): Promise<ContextoDaOrigem | null>;
};

export type AcessoEmitido = {
  readonly token: string;
  readonly tipo: FormaDoAcesso;
  readonly expiraEm: string | null;
  readonly cabecalhosExtras?: Readonly<Record<string, string>>;
};

export type LimiteDeChamadas = (chave: string) => boolean;

export type AcessoDoWorker = {
  emitir(origem: OrigemDoToken, worker: WorkerContext): Promise<Result<AcessoEmitido, Failure>>;
  renovarProativo(input: { readonly limite: number }, worker: WorkerContext): Promise<Result<ResumoDaVarredura, Failure>>;
};

const STATUS_UTILIZAVEIS = new Set(['active', 'expiring', 'degraded']);

const MOTIVO_DA_FALHA_DO_COFRE: Record<FalhaDoCofre, { readonly motivo: string; readonly falha: Failure }> = {
  sem_token: { motivo: 'sem_token', falha: failure('conflict', 'A conexão não tem token no cofre: reautorize.', { motivo: 'sem_token' }) },
  conexao_inexistente: { motivo: 'conexao_inexistente', falha: failure('not_found', 'Conexão não encontrada.') },
  segredo_invalido: { motivo: 'segredo_invalido', falha: failure('validation', 'Segredo inválido.') },
  reautorizar: {
    motivo: 'reauth_pending',
    falha: failure('conflict', 'A plataforma recusou a autorização: reautorize a conexão.', { motivo: 'reauth_pending' }),
  },
  indisponivel: { motivo: 'indisponivel', falha: failure('unavailable', 'Não foi possível obter o token agora. Tente de novo.') },
  sem_provedor: { motivo: 'sem_provedor', falha: failure('unavailable', 'A plataforma desta conexão não está configurada no cofre.') },
  cifra_invalida: { motivo: 'cifra_invalida', falha: failure('unavailable', 'O token guardado não pôde ser lido.') },
};

function descreverOrigem(origem: OrigemDoToken): { readonly tipo: 'coleta' | 'tarefa'; readonly id: string } {
  return 'coletaId' in origem ? { tipo: 'coleta', id: origem.coletaId } : { tipo: 'tarefa', id: origem.tarefaId };
}

function recusa(contexto: ContextoDaOrigem, origem: 'coleta' | 'tarefa'): { readonly motivo: string; readonly falha: Failure } | null {
  if (!contexto.origemEmExecucao) {
    return {
      motivo: 'origem_encerrada',
      falha: failure('conflict', `A ${origem} não está em execução.`, { motivo: 'origem_encerrada' }),
    };
  }
  if (!contexto.tenantAtivo || !contexto.fonteAtiva) {
    return { motivo: 'fonte_inativa', falha: failure('conflict', 'Cliente, organização ou fonte inativos.', { motivo: 'fonte_inativa' }) };
  }
  if (!STATUS_UTILIZAVEIS.has(contexto.connectionStatus)) {
    const motivo = contexto.connectionStatus === 'revoked' ? 'conexao_revogada' : 'reauth_pending';
    return { motivo, falha: failure('conflict', 'A conexão precisa ser reautorizada.', { motivo }) };
  }
  if (!contexto.temToken) return MOTIVO_DA_FALHA_DO_COFRE.sem_token;
  return null;
}

export function createAcessoDoWorker(deps: {
  readonly resolvedor: ResolvedorDeOrigem;
  readonly cofre: CofreDeTokens;
  readonly audit: AuditRecorder;
  readonly limitar: LimiteDeChamadas;
}): AcessoDoWorker {
  return {
    async emitir(origem, worker) {
      const descrita = descreverOrigem(origem);
      if (!deps.limitar(`tokens:${descrita.tipo}:${descrita.id}`)) {
        return err(failure('rate_limited', 'Pedidos de token demais para esta execução.'));
      }

      const contexto = await deps.resolvedor.resolver(origem);
      if (!contexto) return err(failure('not_found', `${descrita.tipo === 'coleta' ? 'Coleta' : 'Tarefa'} não encontrada.`));

      const auditar = (action: string, metadata: Record<string, unknown>) =>
        deps.audit.record({
          organizationId: contexto.organizationId,
          actorType: 'worker',
          actorId: worker.callerFingerprint,
          action,
          targetType: 'connection',
          targetId: contexto.connectionId,
          requestId: worker.requestId,
          sourceIp: worker.sourceIp,
          metadata: { origem: descrita.tipo, origemId: descrita.id, plataforma: contexto.platform, ...metadata },
        });

      const recusada = recusa(contexto, descrita.tipo);
      if (recusada) {
        await auditar('tokens.acesso.recusado', { motivo: recusada.motivo });
        return err(recusada.falha);
      }

      const acesso = await deps.cofre.obterAcesso({ organizationId: contexto.organizationId, connectionId: contexto.connectionId });
      if (!acesso.ok) {
        const traduzida = MOTIVO_DA_FALHA_DO_COFRE[acesso.error];
        await auditar('tokens.acesso.recusado', { motivo: traduzida.motivo });
        return err(traduzida.falha);
      }

      const expiraEm = acesso.value.expiraEm ? acesso.value.expiraEm.toISOString() : null;
      await auditar('tokens.acesso.emitido', { forma: acesso.value.tipo, expiraEm });

      return ok({
        token: acesso.value.token,
        tipo: acesso.value.tipo,
        expiraEm,
        ...(acesso.value.cabecalhosExtras ? { cabecalhosExtras: acesso.value.cabecalhosExtras } : {}),
      });
    },

    async renovarProativo(input, worker) {
      const resumo = await deps.cofre.renovarProativamente(input.limite);
      await deps.audit.record({
        organizationId: null,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'tokens.renovacao_proativa',
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: { ...resumo, limite: input.limite },
      });
      return ok(resumo);
    },
  };
}
