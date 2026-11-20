import { recorteDeFato, type RecorteDeFato } from './fatosDiarios.ts';

const METRICAS_DE_SESSAO = {
  sessoes: 'INT64',
  sessoes_engajadas: 'INT64',
  usuarios: 'INT64',
  novos_usuarios: 'INT64',
  eventos_chave: 'NUMERIC',
  receita: 'NUMERIC',
} as const;

export const RECORTES_GA4: readonly RecorteDeFato[] = [
  recorteDeFato('aquisicao', 'ga4_aquisicao_diario', 'property_id', ['fonte', 'midia', 'campanha', 'canal_padrao'], {
    ...METRICAS_DE_SESSAO,
    duracao_engajamento_seg: 'NUMERIC',
  }),
  recorteDeFato('pagina', 'ga4_pagina_diario', 'property_id', ['pagina'], {
    visualizacoes: 'INT64',
    usuarios_ativos: 'INT64',
    sessoes: 'INT64',
    eventos: 'INT64',
    eventos_chave: 'NUMERIC',
    duracao_engajamento_seg: 'NUMERIC',
  }),
  recorteDeFato('pagina_entrada', 'ga4_pagina_entrada_diario', 'property_id', ['pagina_entrada'], METRICAS_DE_SESSAO),
  recorteDeFato('evento', 'ga4_evento_diario', 'property_id', ['evento'], {
    contagem: 'INT64',
    usuarios: 'INT64',
    valor: 'NUMERIC',
    eventos_chave: 'NUMERIC',
  }),
  recorteDeFato(
    'dispositivo',
    'ga4_dispositivo_diario',
    'property_id',
    ['categoria_dispositivo', 'sistema_operacional', 'navegador', 'plataforma'],
    METRICAS_DE_SESSAO,
  ),
  recorteDeFato('geo', 'ga4_geo_diario', 'property_id', ['pais', 'regiao', 'cidade'], METRICAS_DE_SESSAO),
  recorteDeFato('item', 'ga4_item_diario', 'property_id', ['item'], {
    itens_visualizados: 'INT64',
    itens_no_carrinho: 'INT64',
    itens_comprados: 'INT64',
    receita_item: 'NUMERIC',
  }),
];
