import { agora, type ConfiguracaoFato, type ConfiguracaoScd2, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';
import { fatoAdsDiario } from '@/modules/coleta/infrastructure/tabelas/adsDiario';
import {
  ESQUEMAS_META,
  atributosDoEsquema,
  colunasDoEsquema,
  linhaTipada,
  tiposDoEsquema,
  type EsquemaMeta,
} from '@/modules/coleta/domain/esquemasMeta';

const CHAVE_DA_FONTE = ['organization_id', 'ad_account_id'] as const;

function fatoMeta(esquema: EsquemaMeta): ConfiguracaoFato {
  return {
    tipo: 'fato',
    staging: esquema.staging,
    fato: esquema.tabela,
    chave: [...CHAVE_DA_FONTE, ...esquema.chave],
    colunas: [...CHAVE_DA_FONTE, ...colunasDoEsquema(esquema), 'versao_api', 'execucao_id', 'inserido_em'],
    tipos: tiposDoEsquema(esquema),
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      ad_account_id: ctx.externalId,
      ...linhaTipada(esquema, linha),
      versao_api: typeof linha.versaoApi === 'string' ? linha.versaoApi : null,
      execucao_id: ctx.execucaoId,
      inserido_em: agora(),
    }),
  };
}

function dimensaoMeta(esquema: EsquemaMeta): ConfiguracaoScd2 {
  return {
    tipo: 'scd2',
    staging: esquema.staging,
    dimensao: esquema.tabela,
    chave: [...CHAVE_DA_FONTE, ...esquema.chave],
    atributos: atributosDoEsquema(esquema),
    tipos: tiposDoEsquema(esquema),
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      ad_account_id: ctx.externalId,
      ...linhaTipada(esquema, linha),
    }),
  };
}

const TABELAS_DO_ESQUEMA: TabelasDaPlataforma = Object.fromEntries(
  Object.values(ESQUEMAS_META).map((esquema) => [
    esquema.nome,
    esquema.tipo === 'fato' ? fatoMeta(esquema) : dimensaoMeta(esquema),
  ]),
);

export const TABELAS_META: TabelasDaPlataforma = {
  padrao: fatoAdsDiario('meta'),
  ...TABELAS_DO_ESQUEMA,
};
