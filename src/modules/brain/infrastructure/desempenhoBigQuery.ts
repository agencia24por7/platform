import { BigQuery } from '@google-cloud/bigquery';
import { env } from '@/shared/config/env';
import { comRetentativa } from '@/modules/coleta/infrastructure/retentativaBigQuery';
import type { MedidorDeDesempenho } from '../application/portas.ts';
import {
  MOEDA_MISTA,
  RECORTES_DE_DESEMPENHO,
  type EscopoMedido,
  type LinhaDeDesempenho,
  type RecorteDeDesempenho,
} from '../domain/desempenho.ts';
import { consultasDeDesempenho } from './sqlDoDesempenho.ts';

type Numero = number | string | null | undefined;
type Data = { value: string } | string;
export type LinhaDoBigQuery = {
  platform: string;
  periodo: Data;
  recorte: string;
  chave: string | null;
  rotulo: string | null;
  investimento_centavos: Numero;
  impressoes: Numero;
  cliques: Numero;
  conversoes: Numero;
  receita_centavos: Numero;
  moeda: string | null;
};

const positivo = (valor: Numero): number => Math.max(0, Number(valor ?? 0) || 0);

export function normalizarLinha(linha: LinhaDoBigQuery): LinhaDeDesempenho | null {
  if (!(RECORTES_DE_DESEMPENHO as readonly string[]).includes(linha.recorte)) return null;
  const recorte = linha.recorte as RecorteDeDesempenho;
  const chave = recorte === 'total' ? '' : (linha.chave ?? '').slice(0, 200);
  if (recorte !== 'total' && chave === '') return null;
  const periodo = typeof linha.periodo === 'string' ? linha.periodo : linha.periodo.value;
  const rotulo = (linha.rotulo ?? '').slice(0, 200) || chave || 'Total';
  const receita = linha.receita_centavos === null || linha.receita_centavos === undefined ? null : positivo(linha.receita_centavos);
  return {
    platform: linha.platform,
    periodo,
    recorte,
    chave,
    rotulo,
    investimentoCentavos: positivo(linha.investimento_centavos),
    impressoes: positivo(linha.impressoes),
    cliques: positivo(linha.cliques),
    conversoes: Math.round(positivo(linha.conversoes) * 10_000) / 10_000,
    receitaCentavos: receita,
    moeda: /^[A-Z]{3}$/.test(linha.moeda ?? '') ? (linha.moeda as string) : MOEDA_MISTA,
  };
}

export function createMedidorDeDesempenhoBigQuery(): MedidorDeDesempenho {
  const config = env();
  const projeto = config.BQ_PROJECT_ID;
  if (!projeto) return { disponivel: false, medir: () => Promise.reject(new Error('BigQuery não configurado')) };
  const bigquery = new BigQuery({ projectId: projeto });
  const destino = { projeto, conjuntoDeDados: config.BQ_DATASET };
  const maximumBytesBilled = String(config.BQ_MAXIMO_BYTES_FATURADOS);

  return {
    disponivel: true,
    async medir(cliente, plataformas, janela) {
      const params = {
        organizacao: cliente.organizationId,
        cliente_id: cliente.clienteId,
        inicio_serie: BigQuery.date(janela.inicioDaSerie),
        fim_serie: BigQuery.date(janela.fimDaSerie),
        inicio_janela: BigQuery.date(janela.inicioDaJanela),
      };
      const linhas: LinhaDeDesempenho[] = [];
      const medidos: EscopoMedido[] = [];
      const falhas: string[] = [];
      for (const consulta of consultasDeDesempenho(destino, plataformas)) {
        try {
          const [brutas] = await comRetentativa(() => bigquery.query({ query: consulta.sql, params, maximumBytesBilled }));
          for (const bruta of brutas as LinhaDoBigQuery[]) {
            const linha = normalizarLinha(bruta);
            if (linha) linhas.push(linha);
          }
          medidos.push(...consulta.escopos);
        } catch {
          falhas.push(consulta.nome);
        }
      }
      return { linhas, medidos, falhas };
    },
  };
}
