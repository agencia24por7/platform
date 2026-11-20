import { BigQuery } from '@google-cloud/bigquery';
import { env } from '@/shared/config/env';
import { paraParametroBigQuery } from '@/modules/coleta/infrastructure/parametrosBigQuery';
import { comRetentativa } from '@/modules/coleta/infrastructure/retentativaBigQuery';
import type { MedidaNova, MedidorDeCobertura } from '../application/portas.ts';
import { sqlDaMedicao, sqlDoMergeDaCobertura, TIPOS_DA_COBERTURA } from './sqlDaCobertura.ts';

type LinhaMedida = {
  tabela: string;
  desde: { value: string } | string | null;
  ate: { value: string } | string | null;
  linhas: number | string | null;
  dias_com_dado: number | string | null;
};

function data(valor: LinhaMedida['desde']): string | null {
  if (valor === null || valor === undefined) return null;
  return typeof valor === 'string' ? valor : valor.value;
}

export function createMedidorBigQuery(): MedidorDeCobertura {
  const config = env();
  const projeto = config.BQ_PROJECT_ID;
  if (!projeto) return { disponivel: false, medir: () => Promise.reject(new Error('BigQuery não configurado')) };
  const bigquery = new BigQuery({ projectId: projeto });
  const destino = { projeto, conjuntoDeDados: config.BQ_DATASET };
  const maximumBytesBilled = String(config.BQ_MAXIMO_BYTES_FATURADOS);

  return {
    disponivel: true,
    async medir(cliente, objetos, desde, ate) {
      const [linhas] = await comRetentativa(() =>
        bigquery.query({
          query: sqlDaMedicao(destino, objetos),
          params: { cliente_id: cliente.clienteId, desde: BigQuery.date(desde), ate: BigQuery.date(ate) },
          maximumBytesBilled,
        }),
      );
      const medidas: MedidaNova[] = (linhas as LinhaMedida[]).map((linha) => ({
        tabela: linha.tabela,
        desde: data(linha.desde),
        ate: data(linha.ate),
        linhas: Number(linha.linhas ?? 0),
        diasComDado: linha.dias_com_dado === null ? null : Number(linha.dias_com_dado),
      }));
      const agora = new Date();
      const paraGravar = medidas.map((m) => ({
        organization_id: cliente.organizationId,
        client_id: cliente.clienteId,
        tabela: m.tabela,
        desde: paraParametroBigQuery(m.desde, 'DATE'),
        ate: paraParametroBigQuery(m.ate, 'DATE'),
        linhas: m.linhas,
        dias_com_dado: m.diasComDado,
        medido_em: paraParametroBigQuery(agora, 'TIMESTAMP'),
      }));
      if (paraGravar.length > 0) {
        await comRetentativa(async () => {
          const [job] = await bigquery.createQueryJob({
            query: sqlDoMergeDaCobertura(destino),
            params: { linhas: paraGravar },
            types: { linhas: [TIPOS_DA_COBERTURA] },
            maximumBytesBilled,
          });
          await job.getQueryResults();
        });
      }
      return medidas;
    },
  };
}
