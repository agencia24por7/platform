import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { AbrirColetaInput, Coleta, FecharColetaInput, FonteElegivel } from '@/modules/coleta/domain/coleta';
import { FONTE_OCUPADA, chaveDaFonte, isJanelaSana } from '@/modules/coleta/domain/coleta';
import { recusaDaGravacao } from '@/modules/coleta/domain/gravacaoPermitida';
import { HISTORICO_VAZIO, calcularPausa, ordemDeColeta, planejarColetaIncremental, podeRodar } from '@/modules/coleta/domain/janelaIncremental';
import { resolverAbertura } from '@/modules/coleta/domain/tentativaDeColeta';
import { ModoColeta, fonteDe, janelaAteOntem, janelaDias, plataformasColetaveis } from '@/modules/coleta/domain/mapaDeFontes';
import type { ColetaRepository } from '@/modules/coleta/infrastructure/coletaRepository';
import type { BigQueryGravador } from '@/modules/coleta/infrastructure/bigQueryGravador';

const MAX_WINDOW_DAYS = 28;
const TETO_DE_FONTES_DA_ROTINA = 2000;
export const HORAS_ATE_EXPIRAR_RUNNING = 8;

export type WorkerIdentity = { readonly requestId: string; readonly callerFingerprint: string; readonly sourceIp: string | null };

export type GravarColetaInput = { readonly coletaId: string; readonly linhas: readonly Record<string, unknown>[] };

export type ColetaService = {
  fontes(limit: number, modo: ModoColeta, worker: WorkerIdentity): Promise<readonly FonteElegivel[]>;
  abrir(input: AbrirColetaInput, worker: WorkerIdentity): Promise<Result<Coleta, Failure>>;
  gravar(
    input: GravarColetaInput,
    worker: WorkerIdentity,
  ): Promise<Result<{ linhasGravadas: number; linhasDescartadas: number; descartesDeChave: Readonly<Record<string, number>> }, Failure>>;
  fechar(input: FecharColetaInput, worker: WorkerIdentity): Promise<Result<Coleta, Failure>>;
};

export function createColetaService(coletas: ColetaRepository, audit: AuditRecorder, bigQuery: BigQueryGravador): ColetaService {
  async function fontesPorJanelaFixa(limit: number, modo: ModoColeta): Promise<FonteElegivel[]> {
    const brutas = await coletas.fontes(limit, plataformasColetaveis());
    return brutas.map((fonte) => ({ ...fonte, janelaSugerida: janelaAteOntem(fonte.platform, modo), marcaDagua: null, comDimensoes: true, marcaPorParcial: false }));
  }

  async function fontesIncrementais(limit: number): Promise<FonteElegivel[]> {
    await coletas.expirarColetasRunning(HORAS_ATE_EXPIRAR_RUNNING);
    const [brutas, historicos] = await Promise.all([coletas.fontes(TETO_DE_FONTES_DA_ROTINA, plataformasColetaveis()), coletas.historicos()]);
    const agora = new Date();
    return brutas
      .map((fonte) => {
        const historico = historicos.get(chaveDaFonte(fonte.fonteTipo, fonte.fonteId)) ?? HISTORICO_VAZIO;
        return { fonte, plano: planejarColetaIncremental(fonte.platform, historico, agora), ultimaTentativaEm: historico.ultimaTentativaEm ?? null };
      })
      .filter(({ plano }) => podeRodar(plano))
      .sort(ordemDeColeta)
      .slice(0, limit)
      .map(({ fonte, plano }) => ({
        ...fonte,
        janelaSugerida: plano.janela,
        marcaDagua: plano.marcaDagua,
        comDimensoes: plano.comDimensoes,
        marcaPorParcial: plano.marcaPorParcial,
      }));
  }

  return {
    async fontes(limit, modo, worker) {
      const entries = modo === ModoColeta.Incremental ? await fontesIncrementais(limit) : await fontesPorJanelaFixa(limit, modo);
      await audit.record({
        organizationId: null,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'coleta.fontes.lidas',
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: { returned: entries.length, limit, modo },
      });
      return entries;
    },

    async abrir(input, worker) {
      if (!isJanelaSana(input.window, MAX_WINDOW_DAYS)) {
        return err(failure('validation', `Janela inválida ou maior que ${MAX_WINDOW_DAYS} dias.`));
      }

      const existing = await coletas.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        const existingFonteId = existing.fonteTipo === 'ad_account' ? existing.adAccountId : existing.connectionAccountId;
        if (existing.fonteTipo !== input.fonteTipo || existingFonteId !== input.fonteId) {
          return err(failure('conflict', 'Esta chave de idempotência já pertence a uma execução de outra fonte.'));
        }
        if (existing.status === 'running') return ok(existing);
      }
      const abertura = existing ? await resolverAbertura(input.idempotencyKey, (k) => coletas.findByIdempotencyKey(k)) : null;
      if (abertura?.tipo === 'existente') return ok(abertura.coleta);
      if (abertura?.tipo === 'esgotada') return err(failure('conflict', 'Tentativas demais com esta chave de idempotência.'));
      const chave = abertura?.tipo === 'nova' ? abertura.chave : input.idempotencyKey;

      const resolved = await coletas.resolveFonte(input.fonteTipo, input.fonteId);
      if (!resolved) return err(failure('not_found', 'Fonte de coleta não encontrada ou inelegível.'));

      const fonte = fonteDe(resolved.platform);
      if (!fonte.ativaNoV1) {
        return err(failure('validation', `Plataforma ${resolved.platform} está fora do v1 da camada de coleta: ${fonte.motivoForaDoV1}`));
      }

      const limiteJanela = janelaDias(resolved.platform, input.mode) || MAX_WINDOW_DAYS;
      if (!isJanelaSana(input.window, limiteJanela)) {
        return err(failure('validation', `Janela maior que ${limiteJanela} dias para o modo ${input.mode} nesta plataforma.`));
      }

      const coleta = await coletas.abrir({ ...input, idempotencyKey: chave }, resolved.organizationId, resolved.clientId, resolved.platform);
      if (coleta === FONTE_OCUPADA) {
        return err(failure('conflict', 'Já existe uma coleta em execução para esta fonte.', { motivo: FONTE_OCUPADA }));
      }

      await audit.record({
        organizationId: resolved.organizationId,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'coleta.execucao.abrir',
        targetType: 'coleta',
        targetId: coleta.id,
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: {
          fonteTipo: coleta.fonteTipo,
          platform: coleta.platform,
          mode: coleta.mode,
          window: coleta.window,
          idempotencyKey: chave,
          n8nExecutionId: input.n8nExecutionId,
        },
      });

      return ok(coleta);
    },

    async gravar(input, worker) {
      const contexto = await coletas.resolveContextoDeGravacao(input.coletaId);
      const recusa = recusaDaGravacao(contexto);
      if (recusa || !contexto) return err(failure(recusa?.codigo ?? 'not_found', recusa?.mensagem ?? 'Execução não encontrada.'));

      const resultado = await bigQuery.gravar(contexto.platform, input.linhas, {
        organizationId: contexto.organizationId,
        clientId: contexto.clientId,
        externalId: contexto.externalId,
        currency: contexto.currency,
        execucaoId: input.coletaId,
      });

      if (!resultado.ok) {
        return err(failure('unavailable', `Não foi possível gravar no BigQuery: ${resultado.motivo}`));
      }

      await audit.record({
        organizationId: contexto.organizationId,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'coleta.execucao.gravar',
        targetType: 'coleta',
        targetId: input.coletaId,
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: {
          platform: contexto.platform,
          linhasGravadas: resultado.linhasGravadas,
          linhasDescartadas: resultado.linhasDescartadas,
          descartesDeChave: resultado.descartesDeChave,
        },
      });

      return ok({
        linhasGravadas: resultado.linhasGravadas,
        linhasDescartadas: resultado.linhasDescartadas,
        descartesDeChave: resultado.descartesDeChave,
      });
    },

    async fechar(input, worker) {
      const closed = await coletas.fechar(input);
      if (!closed) return err(failure('conflict', 'Execução já encerrada.'));

      if (closed.status === 'success' || closed.status === 'partial') {
        const fonteConcluida = closed.fonteTipo === 'ad_account' ? closed.adAccountId : closed.connectionAccountId;
        if (fonteConcluida) await coletas.marcarColetaConcluida(closed.fonteTipo, fonteConcluida, closed.finishedAt ?? new Date());
      }

      const pausa = closed.status === 'failed' && closed.errorCode === 'limite_de_uso' ? calcularPausa(closed.platform, input.pausa ?? null) : null;
      if (pausa) await coletas.registrarPausa(closed.id, pausa.ate, pausa.motivo, pausa.escopo);

      if (input.errorCode === 'reauth_pending') {
        const fonteId = closed.fonteTipo === 'ad_account' ? closed.adAccountId : closed.connectionAccountId;
        if (fonteId) await coletas.marcarFalhaDeAuth(closed.fonteTipo, fonteId);
      }

      await bigQuery.registrarQc({
        organizationId: closed.organizationId,
        clientId: closed.clientId,
        execucaoId: closed.id,
        platform: closed.platform,
        fonteId: (closed.fonteTipo === 'ad_account' ? closed.adAccountId : closed.connectionAccountId) ?? '',
        modo: closed.mode,
        windowStart: closed.window.start,
        windowEnd: closed.window.end,
        status: closed.status,
        qualidadeResumo: closed.qualidadeResumo,
      });

      await audit.record({
        organizationId: closed.organizationId,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'coleta.execucao.fechar',
        targetType: 'coleta',
        targetId: closed.id,
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: {
          status: closed.status,
          durationMs: closed.durationMs,
          rowsReceived: closed.rowsReceived,
          rowsWritten: closed.rowsWritten,
          requestCount: closed.requestCount,
          errorCode: closed.errorCode,
          qualidade: closed.qualidadeResumo,
        },
      });

      return ok(closed);
    },
  };
}
