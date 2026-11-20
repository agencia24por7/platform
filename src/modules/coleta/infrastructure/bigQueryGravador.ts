import { BigQuery, type Query } from '@google-cloud/bigquery';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import type { Platform } from '@/modules/connections/domain/connection';
import type { RelatorioDeExecucao } from '@/modules/coleta/domain/qualidade';
import { linhaParaBigQuery, paraParametroBigQuery } from '@/modules/coleta/infrastructure/parametrosBigQuery';
import {
  agruparPorTabela,
  colunasDoStagingScd2,
  dividirEmLotes,
  separarPorChaveValida,
  sqlInsercaoPorUnnest,
  sqlMergeFato,
  sqlMergeSnapshot,
  sqlScd2,
  tiposDoStagingScd2,
} from '@/modules/coleta/infrastructure/sqlDaGravacao';
import { ambienteReal, comRetentativa } from '@/modules/coleta/infrastructure/retentativaBigQuery';
import { TABELAS_POR_PLATAFORMA } from '@/modules/coleta/infrastructure/tabelas';
import {
  agora,
  type ConfiguracaoFato,
  type ConfiguracaoScd2,
  type ConfiguracaoSnapshot,
  type ConfiguracaoTabela,
  type ContextoGravacao,
  type LinhaBruta,
  type TiposDasColunas,
} from '@/modules/coleta/infrastructure/tabelas/tipos';

export type { ContextoGravacao } from '@/modules/coleta/infrastructure/tabelas/tipos';

export type ResultadoGravacao =
  | { readonly ok: true; readonly linhasGravadas: number; readonly linhasDescartadas: number }
  | { readonly ok: false; readonly motivo: string };

export type BigQueryGravador = {
  readonly available: boolean;
  gravar(platform: Platform, linhas: readonly LinhaBruta[], ctx: ContextoGravacao): Promise<ResultadoGravacao>;
  registrarQc(execucao: {
    readonly organizationId: string;
    readonly clientId: string;
    readonly execucaoId: string;
    readonly platform: Platform;
    readonly fonteId: string;
    readonly modo: string;
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly status: string;
    readonly qualidadeResumo: RelatorioDeExecucao | null;
  }): Promise<void>;
};

const nomeDaTabela = (cfg: ConfiguracaoTabela): string =>
  cfg.tipo === 'fato' ? cfg.fato : cfg.tipo === 'scd2' ? cfg.dimensao : cfg.tabela;

export function createBigQueryGravador(): BigQueryGravador {
  const config = env();
  const available = Boolean(config.BQ_PROJECT_ID);
  const bigquery = available ? new BigQuery({ projectId: config.BQ_PROJECT_ID }) : null;
  const dataset = config.BQ_DATASET;
  const tabela = (nome: string) => `\`${config.BQ_PROJECT_ID}.${dataset}.${nome}\``;

  const maximumBytesBilled = String(config.BQ_MAXIMO_BYTES_FATURADOS);

  async function executar(opcoes: Query): Promise<void> {
    await comRetentativa(
      async () => {
        const [job] = await bigquery!.createQueryJob({ ...opcoes, maximumBytesBilled });
        await job.getQueryResults();
      },
      undefined,
      ambienteReal((tentativa, erro) =>
        logger.warn('coleta.bigquery.retentativa', { tentativa, error: erro instanceof Error ? erro.message : 'desconhecido' })),
    );
  }

  async function inserirLinhas(destino: string, colunas: readonly string[], tipos: TiposDasColunas, linhas: readonly Record<string, unknown>[]): Promise<void> {
    const query = sqlInsercaoPorUnnest(tabela(destino), colunas);
    for (const lote of dividirEmLotes(linhas.map((linha) => linhaParaBigQuery(linha, tipos)))) {
      await executar({ query, params: { linhas: lote }, types: { linhas: [tipos] } });
    }
  }

  const doLote = (ctx: ContextoGravacao, inseridoEm: string) => ({
    params: {
      execucaoId: ctx.execucaoId,
      inseridoEm: paraParametroBigQuery(inseridoEm, 'TIMESTAMP'),
      organizationId: ctx.organizationId,
    },
    types: { inseridoEm: 'TIMESTAMP' },
  });

  async function gravarFato(cfg: ConfiguracaoFato, mapeadas: readonly Record<string, unknown>[], ctx: ContextoGravacao): Promise<void> {
    const inseridoEm = agora();
    const comControle = mapeadas.map((linha) => ({ ...linha, execucao_id: ctx.execucaoId, inserido_em: inseridoEm }));
    await inserirLinhas(cfg.staging, cfg.colunas, cfg.tipos, comControle);
    await executar({ query: sqlMergeFato(tabela(cfg.fato), tabela(cfg.staging), cfg), ...doLote(ctx, inseridoEm) });
  }

  async function gravarScd2(cfg: ConfiguracaoScd2, mapeadas: readonly Record<string, unknown>[], ctx: ContextoGravacao): Promise<void> {
    const inseridoEm = agora();
    const comControle = mapeadas.map((linha) => ({ ...linha, execucao_id: ctx.execucaoId, inserido_em: inseridoEm }));
    await inserirLinhas(cfg.staging, colunasDoStagingScd2(cfg), tiposDoStagingScd2(cfg), comControle);
    const lote = doLote(ctx, inseridoEm);
    await executar({
      query: sqlScd2(tabela(cfg.dimensao), tabela(cfg.staging), cfg),
      params: { ...lote.params, agora: paraParametroBigQuery(agora(), 'TIMESTAMP') },
      types: { ...lote.types, agora: 'TIMESTAMP' },
    });
  }

  async function gravarSnapshot(cfg: ConfiguracaoSnapshot, mapeadas: readonly Record<string, unknown>[], ctx: ContextoGravacao): Promise<void> {
    const colunas = Object.keys(cfg.tipos);
    const query = sqlMergeSnapshot(tabela(cfg.tabela), { chave: cfg.chave, colunas, colunaMomento: cfg.colunaMomento });
    for (const lote of dividirEmLotes(mapeadas.map((linha) => linhaParaBigQuery(linha, cfg.tipos)))) {
      await executar({ query, params: { linhas: lote, organizationId: ctx.organizationId }, types: { linhas: [cfg.tipos] } });
    }
  }

  async function gravarTabela(cfg: ConfiguracaoTabela, linhas: readonly LinhaBruta[], ctx: ContextoGravacao): Promise<number> {
    const preparadas = cfg.preparar ? cfg.preparar(linhas) : linhas;
    if (preparadas.length === 0) return 0;
    const { validas, descartadas } = separarPorChaveValida(preparadas.map((linha) => cfg.mapear(linha, ctx)), cfg.chave, cfg.tipos);
    if (descartadas > 0) logger.warn('coleta.bigquery.chave_invalida', { tabela: nomeDaTabela(cfg), descartadas });
    if (validas.length === 0) return 0;

    if (cfg.tipo === 'fato') await gravarFato(cfg, validas, ctx);
    else if (cfg.tipo === 'scd2') await gravarScd2(cfg, validas, ctx);
    else await gravarSnapshot(cfg, validas, ctx);
    return validas.length;
  }

  return {
    available,

    async gravar(platform, linhas, ctx) {
      if (!available || !bigquery) return { ok: false, motivo: 'bigquery_indisponivel' };

      const tabelas = TABELAS_POR_PLATAFORMA[platform];
      if (!tabelas) return { ok: false, motivo: 'plataforma_sem_mapeamento' };

      const agrupamento = agruparPorTabela(linhas, Object.keys(tabelas));
      if (!agrupamento.ok) {
        logger.error('coleta.bigquery.gravar.tabela', { platform, motivo: agrupamento.motivo });
        return { ok: false, motivo: agrupamento.motivo };
      }

      let linhasGravadas = 0;
      let linhasDescartadas = 0;
      for (const [nome, grupo] of agrupamento.grupos) {
        try {
          const gravadas = await gravarTabela(tabelas[nome]!, grupo, ctx);
          linhasGravadas += gravadas;
          linhasDescartadas += grupo.length - gravadas;
        } catch (error) {
          logger.error('coleta.bigquery.gravar.erro', {
            platform,
            tabela: nome,
            error: error instanceof Error ? error.message : 'desconhecido',
          });
          return { ok: false, motivo: 'falha_ao_gravar' };
        }
      }
      return { ok: true, linhasGravadas, linhasDescartadas };
    },

    async registrarQc(execucao) {
      if (!available || !bigquery) return;

      try {
        const query = `INSERT INTO \`${config.BQ_PROJECT_ID}.${dataset}.qc_execucoes\`
          (organization_id, client_id, execucao_id, platform, fonte_id, modo, window_start, window_end,
           fontes_esperadas, fontes_coletadas, linhas, bytes, requests, duracao_ms, status, qualidade_resumo, criado_em)
          VALUES (@organizationId, @clientId, @execucaoId, @platform, @fonteId, @modo, @windowStart, @windowEnd,
           @fontesEsperadas, @fontesColetadas, @linhas, @bytes, @requests, @duracaoMs, @status, PARSE_JSON(@qualidadeResumo), @criadoEm)`;

        const [job] = await bigquery.createQueryJob({
          query,
          maximumBytesBilled,
          params: {
            organizationId: execucao.organizationId,
            clientId: execucao.clientId,
            execucaoId: execucao.execucaoId,
            platform: execucao.platform,
            fonteId: execucao.fonteId,
            modo: execucao.modo,
            windowStart: paraParametroBigQuery(execucao.windowStart, 'DATE'),
            windowEnd: paraParametroBigQuery(execucao.windowEnd, 'DATE'),
            fontesEsperadas: execucao.qualidadeResumo?.fontesEsperadas ?? null,
            fontesColetadas: execucao.qualidadeResumo?.fontesColetadas ?? null,
            linhas: execucao.qualidadeResumo?.volumetria.linhas ?? null,
            bytes: execucao.qualidadeResumo?.volumetria.bytes ?? null,
            requests: execucao.qualidadeResumo?.volumetria.requests ?? null,
            duracaoMs: execucao.qualidadeResumo?.volumetria.duracaoMs ?? null,
            status: execucao.status,
            qualidadeResumo: execucao.qualidadeResumo ? JSON.stringify(execucao.qualidadeResumo) : '{}',
            criadoEm: paraParametroBigQuery(agora(), 'TIMESTAMP'),
          },
          types: {
            windowStart: 'DATE',
            windowEnd: 'DATE',
            fontesEsperadas: 'INT64',
            fontesColetadas: 'INT64',
            linhas: 'INT64',
            bytes: 'INT64',
            requests: 'INT64',
            duracaoMs: 'INT64',
            criadoEm: 'TIMESTAMP',
          },
        });
        await job.getQueryResults();
      } catch (error) {
        logger.error('coleta.bigquery.qc.erro', { error: error instanceof Error ? error.message : 'desconhecido' });
      }
    },
  };
}
