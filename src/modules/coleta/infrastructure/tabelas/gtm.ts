import { agora, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';

export const TABELAS_GTM: TabelasDaPlataforma = {
  padrao: {
    tipo: 'snapshot',
    tabela: 'gov_snapshot_fontes',
    tipos: {
      organization_id: 'STRING', platform: 'STRING', fonte_tipo: 'STRING', fonte_id: 'STRING',
      nome: 'STRING', estado: 'STRING', inactive: 'BOOL', rotulo_esperado: 'STRING', rotulo_observado: 'STRING',
      visto_em: 'TIMESTAMP',
    },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      platform: 'gtm',
      fonte_tipo: 'connection_account',
      fonte_id: ctx.externalId,
      nome: linha.nome ?? null,
      estado: linha.estado ?? null,
      inactive: Boolean(linha.inactive),
      rotulo_esperado: linha.rotuloEsperado ?? null,
      rotulo_observado: linha.rotuloObservado ?? null,
      visto_em: agora(),
    }),
  },
};
