import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { planejarClientes, planejarFontes, type ResumoScd2 } from '@/modules/coleta/domain/dimensoes';
import type { DimensoesBigQuery } from '@/modules/coleta/infrastructure/dimensoesBigQuery';
import type { DimensoesRepository } from '@/modules/coleta/infrastructure/dimensoesRepository';
import { logger } from '@/shared/logging/logger';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';

type WorkerIdentity = { readonly requestId: string; readonly callerFingerprint: string; readonly sourceIp: string | null };

export type ResumoDasDimensoes = {
  readonly fontes: ResumoScd2;
  readonly clientes: ResumoScd2;
  readonly duracaoMs: number;
};

export type DimensoesService = {
  sincronizar(worker: WorkerIdentity): Promise<Result<ResumoDasDimensoes, Failure>>;
  posseMudou(motivo: string): void;
};

export function createDimensoesService(
  estado: DimensoesRepository,
  bigQuery: DimensoesBigQuery,
  audit: AuditRecorder,
  relogio: () => Date = () => new Date(),
): DimensoesService {
  let fila: Promise<unknown> = Promise.resolve();
  let agendada = false;

  async function executar(): Promise<ResumoDasDimensoes> {
    const inicio = Date.now();
    const [fontes, clientes, mudancas, fontesNoBq, clientesNoBq] = await Promise.all([
      estado.fontes(),
      estado.clientes(),
      estado.mudancasDePosse(),
      bigQuery.existentesDeFontes(),
      bigQuery.existentesDeClientes(),
    ]);

    const agora = relogio();
    const planoDeClientes = planejarClientes(clientes, clientesNoBq, agora);
    const planoDeFontes = planejarFontes(fontes, fontesNoBq, mudancas, agora);

    await bigQuery.aplicarClientes(planoDeClientes);
    await bigQuery.aplicarFontes(planoDeFontes);

    return { fontes: planoDeFontes.resumo, clientes: planoDeClientes.resumo, duracaoMs: Date.now() - inicio };
  }

  function emFila(): Promise<ResumoDasDimensoes> {
    const execucao = fila.then(executar, executar);
    fila = execucao.catch(() => undefined);
    return execucao;
  }

  return {
    async sincronizar(worker) {
      if (!bigQuery.available) return err(failure('unavailable', 'BigQuery não configurado (BQ_PROJECT_ID).'));

      const resumo = await emFila();
      await audit.record({
        organizationId: null,
        actorType: 'worker',
        actorId: worker.callerFingerprint,
        action: 'coleta.dimensoes_sincronizadas',
        requestId: worker.requestId,
        sourceIp: worker.sourceIp,
        metadata: resumo,
      });
      return ok(resumo);
    },

    posseMudou(motivo) {
      if (!bigQuery.available || agendada) return;
      agendada = true;
      fila
        .then(() => {
          agendada = false;
          return emFila();
        })
        .then((resumo) => logger.info('coleta.dimensoes.sincronizadas', { motivo, ...resumo }))
        .catch((error: unknown) =>
          logger.error('coleta.dimensoes.erro', { motivo, error: error instanceof Error ? error.message : 'desconhecido' }),
        );
    },
  };
}
