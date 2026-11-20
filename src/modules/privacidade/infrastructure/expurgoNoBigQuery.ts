import { BigQuery } from '@google-cloud/bigquery';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { ambienteReal, comRetentativa } from '@/modules/coleta/infrastructure/retentativaBigQuery';
import type { ExpurgoNoBigQuery } from '@/modules/privacidade/application/expurgoDeFontes';
import { MANIFESTO_DO_BIGQUERY } from '@/modules/privacidade/infrastructure/manifestoDoBigQuery';
import {
  planoDeConformidadeDoYoutube,
  planoDoExpurgoDaFonte,
  validarEntrada,
  type Passo,
} from '@/../scripts/bq/expurgo.mjs';

export function createExpurgoNoBigQuery(): ExpurgoNoBigQuery {
  const config = env();
  const disponivel = Boolean(config.BQ_PROJECT_ID);
  const bigquery = disponivel ? new BigQuery({ projectId: config.BQ_PROJECT_ID }) : null;
  const destino = { projeto: config.BQ_PROJECT_ID ?? '', dataset: config.BQ_DATASET };
  const manifesto = MANIFESTO_DO_BIGQUERY.filter((entrada) => validarEntrada(entrada as never));

  async function executar(passo: Passo): Promise<void> {
    await comRetentativa(
      async () => {
        const [job] = await bigquery!.createQueryJob({
          query: passo.sql,
          maximumBytesBilled: String(config.BQ_MAXIMO_BYTES_FATURADOS),
        });
        await job.getQueryResults();
      },
      undefined,
      ambienteReal((tentativa, erro) =>
        logger.warn('privacidade.bigquery.retentativa', { passo: passo.nome, tentativa, error: erro instanceof Error ? erro.message : 'desconhecido' })),
    );
  }

  async function rodar(passos: readonly Passo[]): Promise<number> {
    if (!bigquery) throw new Error('bigquery_indisponivel');
    for (const passo of passos) await executar(passo);
    return passos.length;
  }

  return {
    disponivel,

    async expurgarFonte(fonte) {
      const passos = await rodar(planoDoExpurgoDaFonte({ manifesto, fonte, destino }));
      logger.info('privacidade.expurgo_de_fonte.ok', { platform: fonte.platform, passos });
    },

    aplicarPrazoDoYoutube: () => rodar(planoDeConformidadeDoYoutube({ manifesto, destino })),
  };
}
