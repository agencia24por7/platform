import { failure, type Failure } from '@/shared/result/failure';
import { ok, type Result } from '@/shared/result/result';
import { logger } from '@/shared/logging/logger';
import type { Relogio, RepositorioDeEstrategia } from '@/modules/strategy/application/portas';
import type { MotorDoPlano } from '@/modules/strategy/application/motorDoPlano';
import { LEASE_DA_EXECUCAO_MS } from '@/modules/strategy/application/motorDoPlano';

export const ORCAMENTO_TOTAL_DA_ROTA_MS = 240_000;

const CODIGOS_TRANSITORIOS = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', '57P01', '08000', '08003', '08006', '40001', '40P01', '53300']);

function classeDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.constructor.name : typeof erro;
}

function erroTransitorio(erro: unknown): boolean {
  const codigo = typeof erro === 'object' && erro !== null && 'code' in erro ? (erro as { code: unknown }).code : undefined;
  return typeof codigo === 'string' && CODIGOS_TRANSITORIOS.has(codigo);
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
};

export type ProcessadorDeExecucoes = {
  avancar(entrada: { readonly limite: number }): Promise<Result<ResumoDoProcessamento, Failure>>;
};

export function createProcessadorDeExecucoes(deps: DependenciasDoProcessador): ProcessadorDeExecucoes {
  const relogio = deps.relogio ?? { agora: () => new Date() };
  const orcamentoTotalMs = deps.orcamentoTotalMs ?? ORCAMENTO_TOTAL_DA_ROTA_MS;
  const leaseMs = deps.leaseMs ?? LEASE_DA_EXECUCAO_MS;

  async function marcarComoInterno(organizationId: string, execucaoId: string, ficha: number): Promise<void> {
    try {
      await deps.repositorio.atualizarExecucao(organizationId, execucaoId, { status: 'falhou', erroCodigo: 'interno', leaseAte: null }, ficha);
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
          const transitorio = erroTransitorio(erro);
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
