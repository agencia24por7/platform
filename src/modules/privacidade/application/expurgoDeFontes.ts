import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { Platform } from '@/modules/connections/domain/connection';
import type { Failure } from '@/shared/result/failure';
import { ok, type Result } from '@/shared/result/result';
import { logger } from '@/shared/logging/logger';

export const PLATAFORMAS_COM_EXPURGO_AO_REMOVER: readonly Platform[] = ['youtube'];

export type ExpurgoPendente = {
  readonly id: string;
  readonly organizationId: string;
  readonly platform: string;
  readonly externalId: string;
};

export type ResumoDaPreparacao = {
  readonly nomesTrocadosPeloId: number;
  readonly enfileirados: number;
  readonly cancelados: number;
};

export type FilaDeExpurgo = {
  enfileirarDaConexao(organizationId: string, connectionId: string): Promise<readonly ExpurgoPendente[]>;
  prepararConformidadeDoYoutube(): Promise<ResumoDaPreparacao>;
  vencidos(limite: number): Promise<readonly ExpurgoPendente[]>;
  registrarResultado(id: string, erro: string | null): Promise<void>;
};

export type ExpurgoNoBigQuery = {
  readonly disponivel: boolean;
  expurgarFonte(fonte: { readonly organizationId: string; readonly platform: string; readonly externalId: string }): Promise<void>;
  aplicarPrazoDoYoutube(): Promise<number>;
};

export type ResultadoDoExpurgoDaConexao = { readonly enfileirados: number; readonly concluidos: number };

export type ResumoDaConformidadeDoYoutube = ResumoDaPreparacao & {
  readonly expurgosConcluidos: number;
  readonly expurgosComFalha: number;
  readonly passosDoPrazoDeTrintaDias: number;
};

type WorkerIdentity = { readonly requestId: string; readonly callerFingerprint: string; readonly sourceIp: string | null };

export type ExpurgoDeFontesService = {
  expurgarDadosDaConexao(input: {
    readonly organizationId: string;
    readonly connectionId: string;
    readonly platform: Platform;
  }): Promise<ResultadoDoExpurgoDaConexao>;
  aplicarConformidadeDoYoutube(worker: WorkerIdentity): Promise<Result<ResumoDaConformidadeDoYoutube, Failure>>;
};

export const LIMITE_DE_EXPURGOS_POR_RODADA = 50;

const mensagemDe = (erro: unknown): string => (erro instanceof Error ? erro.message : 'desconhecido').slice(0, 500);

export function createExpurgoDeFontesService(
  fila: FilaDeExpurgo,
  bigquery: ExpurgoNoBigQuery,
  audit: AuditRecorder,
): ExpurgoDeFontesService {
  async function tentar(pendente: ExpurgoPendente): Promise<boolean> {
    if (!bigquery.disponivel) return false;
    try {
      await bigquery.expurgarFonte(pendente);
      await fila.registrarResultado(pendente.id, null);
      return true;
    } catch (erro) {
      logger.warn('privacidade.expurgo_de_fonte.falhou', { expurgoId: pendente.id, platform: pendente.platform, error: mensagemDe(erro) });
      await fila.registrarResultado(pendente.id, mensagemDe(erro)).catch(() => undefined);
      return false;
    }
  }

  return {
    async expurgarDadosDaConexao(input) {
      if (!PLATAFORMAS_COM_EXPURGO_AO_REMOVER.includes(input.platform)) return { enfileirados: 0, concluidos: 0 };
      try {
        const pendentes = await fila.enfileirarDaConexao(input.organizationId, input.connectionId);
        let concluidos = 0;
        for (const pendente of pendentes) if (await tentar(pendente)) concluidos += 1;
        return { enfileirados: pendentes.length, concluidos };
      } catch (erro) {
        logger.error('privacidade.expurgo_da_conexao.nao_enfileirado', { connectionId: input.connectionId, error: mensagemDe(erro) });
        return { enfileirados: 0, concluidos: 0 };
      }
    },

    async aplicarConformidadeDoYoutube(worker) {
      const preparacao = await fila.prepararConformidadeDoYoutube();
      const vencidos = await fila.vencidos(LIMITE_DE_EXPURGOS_POR_RODADA);
      let concluidos = 0;
      for (const pendente of vencidos) if (await tentar(pendente)) concluidos += 1;
      const passos = bigquery.disponivel ? await bigquery.aplicarPrazoDoYoutube() : 0;

      const resumo: ResumoDaConformidadeDoYoutube = {
        ...preparacao,
        expurgosConcluidos: concluidos,
        expurgosComFalha: vencidos.length - concluidos,
        passosDoPrazoDeTrintaDias: passos,
      };
      await audit.record({
        organizationId: null,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'privacidade.youtube_conformidade',
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: { ...resumo, bigQueryDisponivel: bigquery.disponivel },
      });
      return ok(resumo);
    },
  };
}
