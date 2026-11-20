import { BigQuery } from '@google-cloud/bigquery';
import { env } from '@/shared/config/env';
import type { EstadoDaFonte, EstadoDoCliente, NovaVersao, PlanoScd2, VersaoExistente } from '@/modules/coleta/domain/dimensoes';
import { linhaParaBigQuery, paraParametroBigQuery } from '@/modules/coleta/infrastructure/parametrosBigQuery';
import { comRetentativa } from '@/modules/coleta/infrastructure/retentativaBigQuery';
import { expressaoDaChave, sqlAplicarDimensao } from '@/modules/coleta/infrastructure/sqlDasDimensoes';

type ConfiguracaoDaDimensao<A> = {
  readonly tabela: string;
  readonly colunasDaChave: readonly string[];
  readonly tipos: Readonly<Record<string, string>>;
  readonly linha: (versao: NovaVersao<A>) => Record<string, unknown>;
};

const VALIDADE = {
  valido_de: 'TIMESTAMP',
  valido_ate: 'TIMESTAMP',
  atual: 'BOOL',
  hash_versao: 'STRING',
} as const;

const validade = <A>(versao: NovaVersao<A>) => ({
  valido_de: versao.validoDe,
  valido_ate: versao.validoAte,
  atual: versao.atual,
  hash_versao: versao.hash,
});

const DIM_FONTE: ConfiguracaoDaDimensao<EstadoDaFonte> = {
  tabela: 'dim_fonte_scd2',
  colunasDaChave: ['organization_id', 'platform', 'external_id'],
  tipos: {
    sk: 'STRING', organization_id: 'STRING', platform: 'STRING', external_id: 'STRING', origem: 'STRING',
    client_id: 'STRING', status: 'STRING', nome: 'STRING', ...VALIDADE,
  },
  linha: (versao) => ({
    sk: versao.sk,
    organization_id: versao.atributos.organizationId,
    platform: versao.atributos.platform,
    external_id: versao.atributos.externalId,
    origem: versao.atributos.origem,
    client_id: versao.atributos.clientId,
    status: versao.atributos.status,
    nome: versao.atributos.nome,
    ...validade(versao),
  }),
};

const DIM_CLIENTE: ConfiguracaoDaDimensao<EstadoDoCliente> = {
  tabela: 'dim_cliente_scd2',
  colunasDaChave: ['organization_id', 'client_id'],
  tipos: {
    sk: 'STRING', organization_id: 'STRING', client_id: 'STRING', nome: 'STRING', status: 'STRING',
    parent_client_id: 'STRING', business_model: 'STRING', ...VALIDADE,
  },
  linha: (versao) => ({
    sk: versao.sk,
    organization_id: versao.atributos.organizationId,
    client_id: versao.atributos.clientId,
    nome: versao.atributos.nome,
    status: versao.atributos.status,
    parent_client_id: versao.atributos.parentClientId,
    business_model: versao.atributos.businessModel,
    ...validade(versao),
  }),
};

export type DimensoesBigQuery = {
  readonly available: boolean;
  existentesDeFontes(): Promise<readonly VersaoExistente[]>;
  existentesDeClientes(): Promise<readonly VersaoExistente[]>;
  aplicarFontes(plano: PlanoScd2<EstadoDaFonte>): Promise<void>;
  aplicarClientes(plano: PlanoScd2<EstadoDoCliente>): Promise<void>;
};

export function createDimensoesBigQuery(): DimensoesBigQuery {
  const config = env();
  const available = Boolean(config.BQ_PROJECT_ID);
  const bigquery = available ? new BigQuery({ projectId: config.BQ_PROJECT_ID }) : null;
  const tabela = (nome: string) => `\`${config.BQ_PROJECT_ID}.${config.BQ_DATASET}.${nome}\``;

  function cliente(): BigQuery {
    if (!bigquery) throw new Error('bigquery_indisponivel');
    return bigquery;
  }

  async function existentes<A>(cfg: ConfiguracaoDaDimensao<A>): Promise<readonly VersaoExistente[]> {
    const [linhas] = await cliente().query({
      query: `SELECT ${expressaoDaChave(cfg.colunasDaChave)} AS chave,
                COUNTIF(atual) AS abertas,
                MAX(IF(atual, hash_versao, NULL)) AS hash_aberta
              FROM ${tabela(cfg.tabela)}
              GROUP BY ${cfg.colunasDaChave.join(', ')}`,
    });
    return (linhas as { chave: string; abertas: number; hash_aberta: string | null }[]).map((linha) => ({
      chave: linha.chave,
      abertas: Number(linha.abertas),
      hashAberta: linha.hash_aberta,
    }));
  }

  async function aplicar<A>(cfg: ConfiguracaoDaDimensao<A>, plano: PlanoScd2<A>): Promise<void> {
    if (plano.fechar.length === 0 && plano.inserir.length === 0) return;

    const query = sqlAplicarDimensao(tabela(cfg.tabela), Object.keys(cfg.tipos), cfg.colunasDaChave);

    await comRetentativa(async () => {
      const [job] = await cliente().createQueryJob({
        query,
        maximumBytesBilled: String(config.BQ_MAXIMO_BYTES_FATURADOS),
        params: {
          agora: paraParametroBigQuery(plano.agora, 'TIMESTAMP'),
          fechar: [...plano.fechar],
          novas: plano.inserir.map((versao) => linhaParaBigQuery(cfg.linha(versao), cfg.tipos)),
        },
        types: { agora: 'TIMESTAMP', fechar: ['STRING'], novas: [cfg.tipos] },
      });
      await job.getQueryResults();
    });
  }

  return {
    available,
    existentesDeFontes: () => existentes(DIM_FONTE),
    existentesDeClientes: () => existentes(DIM_CLIENTE),
    aplicarFontes: (plano) => aplicar(DIM_FONTE, plano),
    aplicarClientes: (plano) => aplicar(DIM_CLIENTE, plano),
  };
}
