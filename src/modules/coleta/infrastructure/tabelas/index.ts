import type { Platform } from '@/modules/connections/domain/connection';
import type { TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';
import { TABELAS_GA4 } from '@/modules/coleta/infrastructure/tabelas/ga4';
import { TABELAS_GBP } from '@/modules/coleta/infrastructure/tabelas/gbp';
import { TABELAS_GOOGLE } from '@/modules/coleta/infrastructure/tabelas/google';
import { TABELAS_GTM } from '@/modules/coleta/infrastructure/tabelas/gtm';
import { TABELAS_LEADADS } from '@/modules/coleta/infrastructure/tabelas/leadads';
import { TABELAS_META } from '@/modules/coleta/infrastructure/tabelas/meta';
import { TABELAS_PIXEL } from '@/modules/coleta/infrastructure/tabelas/pixel';
import { TABELAS_RDSTATION } from '@/modules/coleta/infrastructure/tabelas/rdstation';
import { TABELAS_SEARCHCONSOLE } from '@/modules/coleta/infrastructure/tabelas/searchconsole';
import { TABELAS_YOUTUBE } from '@/modules/coleta/infrastructure/tabelas/youtube';

export const TABELAS_POR_PLATAFORMA: Partial<Record<Platform, TabelasDaPlataforma>> = {
  google: TABELAS_GOOGLE,
  meta: TABELAS_META,
  ga4: TABELAS_GA4,
  searchconsole: TABELAS_SEARCHCONSOLE,
  youtube: TABELAS_YOUTUBE,
  gbp: TABELAS_GBP,
  rdstation: TABELAS_RDSTATION,
  pixel: TABELAS_PIXEL,
  leadads: TABELAS_LEADADS,
  gtm: TABELAS_GTM,
};
