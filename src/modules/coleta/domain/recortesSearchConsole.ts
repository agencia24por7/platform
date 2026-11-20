import { recorteDeFato, type RecorteDeFato } from './fatosDiarios.ts';

const METRICAS_DE_BUSCA = {
  cliques: 'INT64',
  impressoes: 'INT64',
  ctr: 'NUMERIC',
  posicao_media: 'NUMERIC',
} as const;

export const RECORTES_SEARCH_CONSOLE: readonly RecorteDeFato[] = [
  recorteDeFato('consulta_pagina', 'search_console_consulta_pagina_diario', 'site', ['consulta', 'pagina'], METRICAS_DE_BUSCA),
  recorteDeFato('pagina', 'search_console_pagina_diario', 'site', ['pagina'], METRICAS_DE_BUSCA),
  recorteDeFato('pais_dispositivo', 'search_console_pais_dispositivo_diario', 'site', ['pais', 'dispositivo'], METRICAS_DE_BUSCA),
  recorteDeFato('aparencia', 'search_console_aparencia_diario', 'site', ['aparencia'], METRICAS_DE_BUSCA),
  recorteDeFato('tipo', 'search_console_tipo_diario', 'site', ['tipo'], METRICAS_DE_BUSCA),
];
