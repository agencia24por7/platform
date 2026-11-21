import { agora, type ConfiguracaoFato, type ConfiguracaoScd2, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';

const numero = (valor: unknown): number => Number(valor ?? 0);
const textoOuNulo = (valor: unknown): string | null => (valor == null || valor === '' ? null : String(valor));
const numeroOuNulo = (valor: unknown): number | null => (valor == null || valor === '' ? null : Number(valor));

const COLUNAS_BASE = ['organization_id', 'channel_id', 'data_dia'] as const;
const CONTROLE = ['execucao_id', 'inserido_em'] as const;
const TIPOS_BASE = { organization_id: 'STRING', channel_id: 'STRING', data_dia: 'DATE', execucao_id: 'STRING', inserido_em: 'TIMESTAMP' } as const;

function fatoDeRecorte(sufixo: string, coluna: string): ConfiguracaoFato {
  return {
    tipo: 'fato',
    staging: `stg_youtube_${sufixo}_diario`,
    fato: `fato_youtube_${sufixo}_diario`,
    chave: ['organization_id', 'channel_id', 'data_dia', coluna],
    colunas: [...COLUNAS_BASE, coluna, 'views', 'minutos_assistidos', ...CONTROLE],
    tipos: { ...TIPOS_BASE, [coluna]: 'STRING', views: 'INT64', minutos_assistidos: 'NUMERIC' },
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      channel_id: ctx.externalId,
      data_dia: linha.metricDate,
      [coluna]: String(linha.categoria ?? ''),
      views: numero(linha.views),
      minutos_assistidos: numero(linha.minutesWatched),
      execucao_id: ctx.execucaoId,
      inserido_em: agora(),
    }),
  };
}

const DIM_VIDEO: ConfiguracaoScd2 = {
  tipo: 'scd2',
  staging: 'stg_youtube_video',
  dimensao: 'dim_youtube_video_scd2',
  renovaCarregadoEm: true,
  chave: ['organization_id', 'channel_id', 'video_id'],
  atributos: ['titulo', 'duracao_segundos', 'publicado_em', 'privacidade', 'categoria_id'],
  tipos: {
    organization_id: 'STRING', channel_id: 'STRING', video_id: 'STRING', titulo: 'STRING',
    duracao_segundos: 'INT64', publicado_em: 'TIMESTAMP', privacidade: 'STRING', categoria_id: 'STRING',
  },
  mapear: (linha, ctx) => ({
    organization_id: ctx.organizationId,
    channel_id: ctx.externalId,
    video_id: String(linha.videoId),
    titulo: textoOuNulo(linha.titulo),
    duracao_segundos: numeroOuNulo(linha.duracaoSegundos),
    publicado_em: textoOuNulo(linha.publicadoEm),
    privacidade: textoOuNulo(linha.privacidade),
    categoria_id: textoOuNulo(linha.categoriaId),
  }),
};

const DIM_PLAYLIST: ConfiguracaoScd2 = {
  tipo: 'scd2',
  staging: 'stg_youtube_playlist',
  dimensao: 'dim_youtube_playlist_scd2',
  renovaCarregadoEm: true,
  chave: ['organization_id', 'channel_id', 'playlist_id'],
  atributos: ['titulo', 'privacidade', 'qtd_videos'],
  tipos: {
    organization_id: 'STRING', channel_id: 'STRING', playlist_id: 'STRING',
    titulo: 'STRING', privacidade: 'STRING', qtd_videos: 'INT64',
  },
  mapear: (linha, ctx) => ({
    organization_id: ctx.organizationId,
    channel_id: ctx.externalId,
    playlist_id: String(linha.playlistId),
    titulo: textoOuNulo(linha.titulo),
    privacidade: textoOuNulo(linha.privacidade),
    qtd_videos: numeroOuNulo(linha.qtdVideos),
  }),
};

const FATO_VIDEO: ConfiguracaoFato = {
  tipo: 'fato',
  staging: 'stg_youtube_video_diario',
  fato: 'fato_youtube_video_diario',
  chave: ['organization_id', 'channel_id', 'video_id', 'data_dia'],
  colunas: [
    'organization_id', 'channel_id', 'video_id', 'data_dia', 'views', 'minutos_assistidos', 'duracao_media_visualizacao_s',
    'curtidas', 'comentarios', 'compartilhamentos', 'inscritos_ganhos', 'inscritos_perdidos', ...CONTROLE,
  ],
  tipos: {
    ...TIPOS_BASE, video_id: 'STRING', views: 'INT64', minutos_assistidos: 'NUMERIC', duracao_media_visualizacao_s: 'NUMERIC',
    curtidas: 'INT64', comentarios: 'INT64', compartilhamentos: 'INT64', inscritos_ganhos: 'INT64', inscritos_perdidos: 'INT64',
  },
  mapear: (linha, ctx) => ({
    organization_id: ctx.organizationId,
    channel_id: ctx.externalId,
    video_id: String(linha.videoId),
    data_dia: linha.metricDate,
    views: numero(linha.views),
    minutos_assistidos: numero(linha.minutesWatched),
    duracao_media_visualizacao_s: numero(linha.averageViewDuration),
    curtidas: numero(linha.likes),
    comentarios: numero(linha.comments),
    compartilhamentos: numero(linha.shares),
    inscritos_ganhos: numero(linha.subscribersGained),
    inscritos_perdidos: numero(linha.subscribersLost),
    execucao_id: ctx.execucaoId,
    inserido_em: agora(),
  }),
};

const FATO_AUDIENCIA: ConfiguracaoFato = {
  tipo: 'fato',
  staging: 'stg_youtube_audiencia_diario',
  fato: 'fato_youtube_audiencia_diario',
  chave: ['organization_id', 'channel_id', 'data_dia', 'faixa_etaria', 'genero'],
  colunas: [...COLUNAS_BASE, 'faixa_etaria', 'genero', 'percentual_espectadores', ...CONTROLE],
  tipos: { ...TIPOS_BASE, faixa_etaria: 'STRING', genero: 'STRING', percentual_espectadores: 'NUMERIC' },
  mapear: (linha, ctx) => ({
    organization_id: ctx.organizationId,
    channel_id: ctx.externalId,
    data_dia: linha.metricDate,
    faixa_etaria: String(linha.faixaEtaria ?? ''),
    genero: String(linha.genero ?? ''),
    percentual_espectadores: numero(linha.percentualEspectadores),
    execucao_id: ctx.execucaoId,
    inserido_em: agora(),
  }),
};

export const TABELAS_YOUTUBE: TabelasDaPlataforma = {
  padrao: {
    tipo: 'fato',
    staging: 'stg_youtube_diario',
    fato: 'fato_youtube_diario',
    chave: ['organization_id', 'channel_id', 'data_dia'],
    colunas: ['organization_id', 'channel_id', 'data_dia', 'views', 'minutos_assistidos', 'inscritos_ganhos', 'inscritos_perdidos', 'receita_estimada', 'execucao_id', 'inserido_em'],
    tipos: {
      organization_id: 'STRING', channel_id: 'STRING', data_dia: 'DATE', views: 'INT64',
      minutos_assistidos: 'NUMERIC', inscritos_ganhos: 'INT64', inscritos_perdidos: 'INT64', receita_estimada: 'NUMERIC',
      execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
    },
    preservarSeNulo: ['receita_estimada'],
    mapear: (linha, ctx) => ({
      organization_id: ctx.organizationId,
      channel_id: ctx.externalId,
      data_dia: linha.metricDate,
      views: Number(linha.views ?? 0),
      minutos_assistidos: Number(linha.minutesWatched ?? 0),
      inscritos_ganhos: Number(linha.subscribersGained ?? 0),
      inscritos_perdidos: Number(linha.subscribersLost ?? 0),
      receita_estimada: linha.estimatedRevenue === null || linha.estimatedRevenue === undefined ? null : Number(linha.estimatedRevenue),
      execucao_id: ctx.execucaoId,
      inserido_em: agora(),
    }),
  },
  dim_video: DIM_VIDEO,
  dim_playlist: DIM_PLAYLIST,
  video_diario: FATO_VIDEO,
  origem_trafego: fatoDeRecorte('origem_trafego', 'origem_trafego'),
  dispositivo: fatoDeRecorte('dispositivo', 'dispositivo'),
  local_reproducao: fatoDeRecorte('local_reproducao', 'local_reproducao'),
  pais: fatoDeRecorte('pais', 'pais'),
  audiencia: FATO_AUDIENCIA,
};
