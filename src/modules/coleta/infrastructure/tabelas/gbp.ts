import { agora, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';

const textoOuNulo = (valor: unknown): string | null => (valor == null || valor === '' ? null : String(valor));
const inteiroOuNulo = (valor: unknown): number | null => (valor == null || valor === '' ? null : Math.trunc(Number(valor)));

export const TABELAS_GBP: TabelasDaPlataforma = {
  padrao: {
    tipo: 'fato',
    staging: 'stg_gbp_diario',
    fato: 'fato_gbp_diario',
    chave: ['organization_id', 'location_id', 'data_dia', 'metrica'],
    colunas: ['organization_id', 'location_id', 'data_dia', 'metrica', 'valor', 'execucao_id', 'inserido_em'],
    tipos: {
      organization_id: 'STRING', location_id: 'STRING', data_dia: 'DATE', metrica: 'STRING',
      valor: 'NUMERIC', execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
    },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      location_id: ctx.externalId,
      data_dia: linha.metricDate,
      metrica: linha.metric,
      valor: Number(linha.value ?? 0),
      execucao_id: ctx.execucaoId,
      inserido_em: agora(),
    }),
  },
  dim_local: {
    tipo: 'scd2',
    staging: 'stg_gbp_local',
    dimensao: 'dim_gbp_local_scd2',
    chave: ['organization_id', 'location_id'],
    atributos: ['nome', 'categoria_primaria', 'endereco', 'cidade', 'estado', 'cep', 'pais', 'status', 'site'],
    tipos: {
      organization_id: 'STRING', location_id: 'STRING', nome: 'STRING', categoria_primaria: 'STRING', endereco: 'STRING',
      cidade: 'STRING', estado: 'STRING', cep: 'STRING', pais: 'STRING', status: 'STRING', site: 'STRING',
    },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      location_id: ctx.externalId,
      nome: textoOuNulo(linha.nome),
      categoria_primaria: textoOuNulo(linha.categoriaPrimaria),
      endereco: textoOuNulo(linha.endereco),
      cidade: textoOuNulo(linha.cidade),
      estado: textoOuNulo(linha.estado),
      cep: textoOuNulo(linha.cep),
      pais: textoOuNulo(linha.pais),
      status: textoOuNulo(linha.status),
      site: textoOuNulo(linha.site),
    }),
  },
  palavras_chave: {
    tipo: 'fato',
    staging: 'stg_gbp_palavras_chave_mensal',
    fato: 'fato_gbp_palavras_chave_mensal',
    chave: ['organization_id', 'location_id', 'mes', 'termo'],
    colunas: ['organization_id', 'location_id', 'mes', 'termo', 'valor', 'limiar', 'execucao_id', 'inserido_em'],
    tipos: {
      organization_id: 'STRING', location_id: 'STRING', mes: 'DATE', termo: 'STRING', valor: 'INT64', limiar: 'INT64',
      execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
    },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      location_id: ctx.externalId,
      mes: linha.mes,
      termo: String(linha.termo),
      valor: inteiroOuNulo(linha.valor),
      limiar: inteiroOuNulo(linha.limiar),
      execucao_id: ctx.execucaoId,
      inserido_em: agora(),
    }),
  },
};
