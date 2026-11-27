import { failure, type Failure } from '@/shared/result/failure';
import { ok, type Result } from '@/shared/result/result';
import { registrarSemFalhar } from '@/modules/audit/application/registrarSemFalhar';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { logger } from '@/shared/logging/logger';
import type { Execucao, Relogio, RepositorioDeEstrategia } from '@/modules/strategy/application/portas';
import type { MotorDoPlano } from '@/modules/strategy/application/motorDoPlano';
import { AGENTE_DE_PLANO, LEASE_DA_EXECUCAO_MS } from '@/modules/strategy/application/motorDoPlano';

export const ORCAMENTO_TOTAL_DA_ROTA_MS = 240_000;

const CLASSES_DETERMINISTICAS = ['22', '23', '42'];
const PROFUNDIDADE_MAXIMA_DA_CAUSA = 4;

function classeDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.constructor.name : typeof erro;
}

function codigosDoErro(erro: unknown, profundidade = 0): string[] {
  if (typeof erro !== 'object' || erro === null || profundidade > PROFUNDIDADE_MAXIMA_DA_CAUSA) return [];
  const { code, cause } = erro as { code?: unknown; cause?: unknown };
  return [...(typeof code === 'string' ? [code] : []), ...codigosDoErro(cause, profundidade + 1)];
}

function erroDeterministico(erro: unknown): boolean {
  return codigosDoErro(erro).some((codigo) => /^[0-9A-Z]{5}$/.test(codigo) && CLASSES_DETERMINISTICAS.includes(codigo.slice(0, 2)));
}

export type ResumoDoProcessamento = {
  readonly encontradas: number;
  readonly reservadas: number;
  readonly avancadas: number;
  readonly concluidas: number;
  readonly falhas: number;
  readonly adiadas: number;
  readonly perdidas: number;
  readonly codigos: Readonly<Record<string, number>>;
};

export type DependenciasDoProcessador = {
  readonly repositorio: RepositorioDeEstrategia;
  readonly motor: MotorDoPlano;
  readonly relogio?: Relogio;
  readonly orcamentoTotalMs?: number;
  readonly leaseMs?: number;
  readonly audit?: AuditRecorder;
};

export type ProcessadorDeExecucoes = {
  avancar(entrada: { readonly limite: number }): Promise<Result<ResumoDoProcessamento, Failure>>;
};

export function createProcessadorDeExecucoes(deps: DependenciasDoProcessador): ProcessadorDeExecucoes {
  const relogio = deps.relogio ?? { agora: () => new Date() };
  const orcamentoTotalMs = deps.orcamentoTotalMs ?? ORCAMENTO_TOTAL_DA_ROTA_MS;
  const leaseMs = deps.leaseMs ?? LEASE_DA_EXECUCAO_MS;

  async function auditarFalha(audit: AuditRecorder, execucao: Execucao): Promise<void> {
    await registrarSemFalhar(audit, {
      organizationId: execucao.organizationId,
      actorType: 'agent',
      actorId: AGENTE_DE_PLANO,
      action: 'strategy.run.step',
      targetType: 'strategy_plan_run',
      targetId: execucao.id,
      requestId: `motor:${execucao.id}:passo:${execucao.etapa}`.slice(0, 120),
      sourceIp: null,
      metadata: {
        clientId: execucao.clientId,
        planoId: execucao.planoId,
        kind: execucao.tipo,
        etapa: execucao.etapa,
        status: 'falhou',
        rodada: execucao.rodada,
        tentativas: execucao.tentativas,
        falhas: execucao.falhas,
        codigo: 'interno',
        transitoria: false,
      },
    });
  }

  async function marcarComoInterno(organizationId: string, execucaoId: string, ficha: number): Promise<void> {
    try {
      const atualizada = await deps.repositorio.atualizarExecucao(organizationId, execucaoId, { status: 'falhou', erroCodigo: 'interno', leaseAte: null }, ficha);
      if (atualizada.ok && deps.audit) await auditarFalha(deps.audit, atualizada.value);
    } catch (erro) {
      logger.error('strategy.execucao.falha_ao_marcar', { erro: classeDoErro(erro), organizationId, execucaoId });
    }
  }

  return {
    async avancar({ limite }) {
      const inicio = relogio.agora().getTime();
      let pendentes;
      try {
        pendentes = await deps.repositorio.descobrirExecucoesPendentes(limite);
      } catch {
        return { ok: false, error: failure('unavailable', 'Não foi possível listar as execuções pendentes.') };
      }
      let reservadas = 0;
      let avancadas = 0;
      let concluidas = 0;
      let falhas = 0;
      let adiadas = 0;
      let perdidas = 0;
      const codigos: Record<string, number> = {};

      for (const pendente of pendentes) {
        const restante = orcamentoTotalMs - (relogio.agora().getTime() - inicio);
        if (restante <= 0) break;
        let ficha: number | null = null;
        try {
          const reservada = await deps.repositorio.reservarExecucao(pendente.organizationId, pendente.id, { leaseMs, agora: relogio.agora() });
          if (!reservada) continue;
          ficha = reservada.tentativas;
          reservadas += 1;
          const resumo = await deps.motor.avancarExecucao(pendente.organizationId, pendente.id, { orcamentoMs: restante, ficha: reservada.tentativas });
          avancadas += resumo.passos;
          const status = resumo.execucao?.status;
          if (status === 'concluida') concluidas += 1;
          else if (status === 'falhou') {
            falhas += 1;
            const codigo = resumo.execucao?.erroCodigo ?? 'interno';
            codigos[codigo] = (codigos[codigo] ?? 0) + 1;
          } else if (resumo.estado === 'adiado') adiadas += 1;
          else if (resumo.estado === 'perdida') perdidas += 1;
        } catch (erro) {
          falhas += 1;
          codigos['excecao'] = (codigos['excecao'] ?? 0) + 1;
          const transitorio = !erroDeterministico(erro);
          logger.error('strategy.execucao.excecao', {
            erro: classeDoErro(erro),
            organizationId: pendente.organizationId,
            execucaoId: pendente.id,
            transitorio,
          });
          if (ficha !== null && !transitorio) await marcarComoInterno(pendente.organizationId, pendente.id, ficha);
        }
      }
      return ok({ encontradas: pendentes.length, reservadas, avancadas, concluidas, falhas, adiadas, perdidas, codigos });
    },
  };
}
