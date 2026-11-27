import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { catalogoGoogle } from '../catalogo/google.ts';
import type { CampoDeMidia } from '../plano.ts';
import { problemasDeDependenciaDoGoogle } from './dependenciasDoGoogle.ts';

const local = (chave: string) => `plano_de_midia/google/${chave}`;
const problemas = (objetivo: string, campos: Record<string, CampoDeMidia['valor']>) =>
  problemasDeDependenciaDoGoogle(new Map(Object.entries(campos)), objetivo, local, catalogoGoogle);
const itens = (quantidade: number, tamanho = 8) => Array.from({ length: quantidade }, (_, i) => `${String(i).padStart(2, '0')}${'x'.repeat(tamanho - 2)}`);

describe('dependencias do Display', () => {
  const estrategia = (valor: string) => ({ campaign_display_bidding_strategy: valor });

  it('lances e alvos so com a estrategia certa', () => {
    assert.deepEqual(problemas('display', { ...estrategia('TARGET_CPA'), campaign_display_target_cpa_micros: 10_000_000 }), []);
    assert.equal(problemas('display', { ...estrategia('MAXIMIZE_CONVERSIONS'), campaign_display_target_cpa_micros: 10_000_000 }).length, 1);
    assert.equal(problemas('display', { ...estrategia('TARGET_CPA') }).length, 1);
    assert.deepEqual(problemas('display', { ...estrategia('MAXIMIZE_CONVERSION_VALUE'), campaign_display_target_roas: 3 }), []);
    assert.equal(problemas('display', { ...estrategia('TARGET_SPEND'), campaign_display_target_roas: 3 }).length, 1);
    assert.deepEqual(problemas('display', { ...estrategia('MANUAL_CPC'), adgroup_display_cpc_bid_micros: 1_000_000 }), []);
    assert.equal(problemas('display', { ...estrategia('MANUAL_CPM'), adgroup_display_cpc_bid_micros: 1_000_000 }).length, 1);
    assert.deepEqual(problemas('display', { ...estrategia('MANUAL_CPM'), adgroup_display_cpm_bid_micros: 1_000_000 }), []);
    assert.equal(problemas('display', { adgroup_display_cpm_bid_micros: 1_000_000 }).length, 1);
  });

  it('micros inteiros, multiplos e maiores que 0', () => {
    assert.equal(problemas('display', { ...estrategia('TARGET_CPA'), campaign_display_target_cpa_micros: 0 }).length, 1);
    assert.equal(problemas('display', { ...estrategia('TARGET_CPA'), campaign_display_target_cpa_micros: 10_001 }).length, 1);
    assert.equal(problemas('display', { ...estrategia('MANUAL_CPC'), adgroup_display_cpc_bid_micros: 1.5 }).length, 1);
    assert.equal(problemas('display', { ...estrategia('MAXIMIZE_CONVERSION_VALUE'), campaign_display_target_roas: 1001 }).length, 1);
  });

  it('rede de conteudo ligada, status PAUSED e limites do anuncio', () => {
    assert.equal(problemas('display', { campaign_display_network_content: false }).length, 1);
    assert.deepEqual(problemas('display', { campaign_display_network_content: true, adgroup_display_status: 'PAUSED', ad_display_status: 'PAUSED' }), []);
    assert.equal(problemas('display', { adgroup_display_status: 'ENABLED', ad_display_status: 'REMOVED' }).length, 2);
    assert.deepEqual(problemas('display', { ad_display_headlines: itens(5, 30), ad_display_descriptions: itens(5, 90), ad_display_long_headline: 'x'.repeat(90), ad_display_business_name: 'x'.repeat(25) }), []);
    assert.equal(problemas('display', { ad_display_headlines: itens(6) }).length, 1);
    assert.equal(problemas('display', { ad_display_headlines: itens(1, 31) }).length, 1);
    assert.equal(problemas('display', { ad_display_descriptions: [] }).length, 1);
    assert.equal(problemas('display', { ad_display_long_headline: 'x'.repeat(91) }).length, 1);
    assert.equal(problemas('display', { ad_display_business_name: 'x'.repeat(26) }).length, 1);
    assert.equal(problemas('display', { ad_display_call_to_action_text: 'x'.repeat(31) }).length, 1);
    assert.equal(problemas('display', { ad_display_logo_images: itens(6) }).length, 2);
  });

  it('logos 4:1 e 1:1 somam no maximo 5 e videos do YouTube ate 5', () => {
    assert.deepEqual(problemas('display', { ad_display_logo_images: itens(3), ad_display_square_logo_images: itens(2) }), []);
    assert.equal(problemas('display', { ad_display_logo_images: itens(3), ad_display_square_logo_images: itens(3) }).length, 1);
    assert.deepEqual(problemas('display', { ad_display_youtube_videos: itens(5) }), []);
    assert.equal(problemas('display', { ad_display_youtube_videos: itens(6) }).length, 1);
  });

  it('imagens 1.91:1 e 1:1 somam no maximo 15 e nenhuma lista fica vazia', () => {
    assert.deepEqual(problemas('display', { ad_display_marketing_images: itens(14), ad_display_square_marketing_images: itens(1) }), []);
    assert.equal(problemas('display', { ad_display_marketing_images: itens(1), ad_display_square_marketing_images: itens(15) }).length, 1);
    assert.equal(problemas('display', { ad_display_marketing_images: [] }).length, 1);
  });
});

describe('dependencias do Performance Max', () => {
  const estrategia = (valor: string) => ({ campaign_pmax_bidding_strategy: valor });

  it('CPA so com MAXIMIZE_CONVERSIONS e ROAS so com MAXIMIZE_CONVERSION_VALUE', () => {
    assert.deepEqual(problemas('performance_max', { ...estrategia('MAXIMIZE_CONVERSIONS'), campaign_pmax_target_cpa_micros: 10_000_000 }), []);
    assert.equal(problemas('performance_max', { ...estrategia('MAXIMIZE_CONVERSION_VALUE'), campaign_pmax_target_cpa_micros: 10_000_000 }).length, 1);
    assert.deepEqual(problemas('performance_max', { ...estrategia('MAXIMIZE_CONVERSION_VALUE'), campaign_pmax_target_roas: 3 }), []);
    assert.equal(problemas('performance_max', { ...estrategia('MAXIMIZE_CONVERSIONS'), campaign_pmax_target_roas: 3 }).length, 1);
    assert.equal(problemas('performance_max', { campaign_pmax_target_roas: 3 }).length, 1);
    assert.equal(problemas('performance_max', { ...estrategia('MAXIMIZE_CONVERSIONS'), campaign_pmax_target_cpa_micros: -1 }).length, 1);
  });

  it('brand guidelines so aceita false', () => {
    assert.deepEqual(problemas('performance_max', { campaign_pmax_brand_guidelines_enabled: false }), []);
    const achados = problemas('performance_max', { campaign_pmax_brand_guidelines_enabled: true });
    assert.equal(achados.length, 1);
    assert.ok(achados[0]!.includes('só false foi comprovado'));
  });

  it('path1 e path2 ate 15 caracteres e path2 exige path1; listas de midia com teto', () => {
    assert.deepEqual(problemas('performance_max', { assetgroup_pmax_path1: 'a'.repeat(15), assetgroup_pmax_path2: 'b'.repeat(15) }), []);
    assert.equal(problemas('performance_max', { assetgroup_pmax_path1: 'a'.repeat(16) }).length, 1);
    assert.equal(problemas('performance_max', { assetgroup_pmax_path1: 'a', assetgroup_pmax_path2: 'b'.repeat(16) }).length, 1);
    assert.deepEqual(problemas('performance_max', { assetgroup_pmax_path2: 'b' }), ['plano_de_midia/google/assetgroup_pmax_path1 (obrigatório com assetgroup_pmax_path2)']);
    for (const [chave, maximo] of [['assetgroup_pmax_portrait_marketing_images', 19], ['assetgroup_pmax_landscape_logos', 5], ['assetgroup_pmax_youtube_video', 5], ['signal_pmax_search_theme', 25]] as const) {
      assert.deepEqual(problemas('performance_max', { [chave]: itens(maximo) }), [], chave);
      assert.equal(problemas('performance_max', { [chave]: itens(maximo + 1) }).length, 1, chave);
    }
  });

  it('asset group: status PAUSED e limites de textos e imagens', () => {
    assert.deepEqual(problemas('performance_max', { assetgroup_pmax_status: 'PAUSED' }), []);
    assert.equal(problemas('performance_max', { assetgroup_pmax_status: 'ENABLED' }).length, 1);
    assert.deepEqual(problemas('performance_max', { assetgroup_pmax_headlines: itens(3, 30), assetgroup_pmax_long_headlines: itens(5, 90), assetgroup_pmax_descriptions: itens(5, 90) }), []);
    assert.equal(problemas('performance_max', { assetgroup_pmax_headlines: itens(2) }).length, 1);
    assert.equal(problemas('performance_max', { assetgroup_pmax_headlines: itens(16) }).length, 1);
    assert.equal(problemas('performance_max', { assetgroup_pmax_long_headlines: itens(6) }).length, 1);
    assert.equal(problemas('performance_max', { assetgroup_pmax_descriptions: itens(1) }).length, 1);
    assert.equal(problemas('performance_max', { assetgroup_pmax_descriptions: itens(2, 91) }).length, 1);
    assert.deepEqual(problemas('performance_max', { assetgroup_pmax_marketing_images: itens(19), assetgroup_pmax_square_marketing_images: itens(19), assetgroup_pmax_logos: itens(5) }), []);
    assert.equal(problemas('performance_max', { assetgroup_pmax_marketing_images: itens(20) }).length, 1);
    assert.equal(problemas('performance_max', { assetgroup_pmax_logos: itens(6) }).length, 1);
    assert.equal(problemas('performance_max', { assetgroup_pmax_business_name: 'x'.repeat(26) }).length, 1);
  });
});

describe('dependencias do Demand Gen', () => {
  const estrategia = (valor: string) => ({ campaign_dg_bidding_strategy: valor });

  it('orcamento minimo por dia', () => {
    assert.deepEqual(problemas('demand_gen', { budget_amount_micros: 50_000_000 }), []);
    assert.equal(problemas('demand_gen', { budget_amount_micros: 20_000_000 }).length, 1);
    assert.deepEqual(problemas('search', { budget_amount_micros: 10_000_000 }), []);
  });

  it('CPA so com TARGET_CPA e obrigatorio nele', () => {
    assert.deepEqual(problemas('demand_gen', { ...estrategia('TARGET_CPA'), campaign_dg_target_cpa_micros: 10_000_000 }), []);
    assert.equal(problemas('demand_gen', { ...estrategia('MAXIMIZE_CONVERSIONS'), campaign_dg_target_cpa_micros: 10_000_000 }).length, 1);
    assert.equal(problemas('demand_gen', { ...estrategia('TARGET_CPA') }).length, 1);
    assert.equal(problemas('demand_gen', { campaign_dg_target_cpa_micros: 10_000_000 }).length, 1);
  });

  it('canais selecionados: conjunto fechado, teto e nao combinam com a estrategia de canais', () => {
    assert.deepEqual(problemas('demand_gen', { adgroup_dg_selected_channels: ['youtube_in_feed', 'discover', 'gmail', 'display', 'youtube_shorts'] }), []);
    assert.equal(problemas('demand_gen', { adgroup_dg_selected_channels: ['youtube_in_feed', 'tiktok'] }).length, 1);
    assert.equal(problemas('demand_gen', { adgroup_dg_selected_channels: [] }).length, 1);
    assert.equal(problemas('demand_gen', { adgroup_dg_selected_channels: ['gmail', 'gmail'] }).length, 1);
    assert.equal(problemas('demand_gen', { adgroup_dg_selected_channels: ['gmail', 'discover', 'display', 'youtube_shorts', 'youtube_in_feed', 'gmail'] }).length, 2);
    assert.deepEqual(problemas('demand_gen', { adgroup_dg_channel_strategy: 'ALL_CHANNELS' }), []);
    assert.deepEqual(problemas('demand_gen', { adgroup_dg_channel_strategy: 'ALL_CHANNELS', adgroup_dg_selected_channels: ['gmail'] }), ['plano_de_midia/google/adgroup_dg_selected_channels (não combina com adgroup_dg_channel_strategy; use um ou outro)']);
  });

  it('lance e CPA de grupo nao existem no catalogo e reprovam fora dele', () => {
    const achados = problemas('demand_gen', { adgroup_dg_cpc_bid_micros: 1_000_000 });
    assert.deepEqual(achados, []);
    assert.ok(!catalogoGoogle.campos.some((campo) => campo.chave === 'adgroup_dg_cpc_bid_micros'));
  });

  it('formato multi-asset exige imagem e nao aceita campos de video', () => {
    assert.deepEqual(problemas('demand_gen', { ad_dg_format: 'MULTI_ASSET', ad_dg_marketing_images: itens(1) }), []);
    assert.deepEqual(problemas('demand_gen', { ad_dg_format: 'MULTI_ASSET', ad_dg_square_marketing_images: itens(1) }), []);
    assert.equal(problemas('demand_gen', { ad_dg_format: 'MULTI_ASSET', ad_dg_portrait_marketing_images: itens(1) }).length, 1);
    assert.equal(problemas('demand_gen', { ad_dg_format: 'MULTI_ASSET', ad_dg_marketing_images: itens(1), ad_dg_video_videos: itens(1) }).length, 1);
  });

  it('formato video-responsive reprova campos de imagem e limita breadcrumbs e videos', () => {
    const video = { ad_dg_format: 'VIDEO_RESPONSIVE', ad_dg_video_videos: itens(1), ad_dg_video_long_headlines: itens(1), ad_dg_name: 'Video' };
    assert.equal(problemas('demand_gen', { ...video, ad_dg_marketing_images: itens(1) }).length, 1);
    assert.equal(problemas('demand_gen', { ...video, ad_dg_marketing_images: itens(1), ad_dg_square_marketing_images: itens(1), ad_dg_tall_portrait_marketing_images: itens(1) }).length, 3);
    assert.deepEqual(problemas('demand_gen', { ...video, ad_dg_video_breadcrumb1: 'a'.repeat(15), ad_dg_video_breadcrumb2: 'b'.repeat(15) }), []);
    assert.equal(problemas('demand_gen', { ...video, ad_dg_video_breadcrumb1: 'a'.repeat(16), ad_dg_video_breadcrumb2: 'b'.repeat(16) }).length, 2);
    assert.deepEqual(problemas('demand_gen', { ...video, ad_dg_video_videos: itens(5) }), []);
    assert.equal(problemas('demand_gen', { ...video, ad_dg_video_videos: itens(6) }).length, 1);
    assert.equal(problemas('demand_gen', { ...video, ad_dg_video_videos: [] }).length, 1);
  });

  it('formato video-responsive exige video, titulos longos e nome', () => {
    assert.equal(problemas('demand_gen', { ad_dg_format: 'VIDEO_RESPONSIVE' }).length, 3);
    assert.deepEqual(problemas('demand_gen', { ad_dg_format: 'VIDEO_RESPONSIVE', ad_dg_video_videos: itens(1), ad_dg_video_long_headlines: itens(1), ad_dg_name: 'Video' }), []);
  });

  it('status PAUSED e limites', () => {
    assert.equal(problemas('demand_gen', { adgroup_dg_status: 'ENABLED', ad_dg_status: 'PAUSED' }).length, 1);
    assert.deepEqual(problemas('demand_gen', { ad_dg_headlines: itens(5, 40), ad_dg_descriptions: itens(5, 90), ad_dg_logo_images: itens(5), ad_dg_business_name: 'x'.repeat(25) }), []);
    assert.equal(problemas('demand_gen', { ad_dg_headlines: itens(1, 41) }).length, 1);
    assert.equal(problemas('demand_gen', { ad_dg_headlines: itens(6) }).length, 1);
    assert.equal(problemas('demand_gen', { ad_dg_logo_images: [] }).length, 1);
    assert.equal(problemas('demand_gen', { ad_dg_logo_images: itens(6) }).length, 1);
    assert.equal(problemas('demand_gen', { ad_dg_video_long_headlines: itens(1, 91), ad_dg_format: 'VIDEO_RESPONSIVE', ad_dg_video_videos: itens(1), ad_dg_name: 'v' }).length, 1);
  });

  it('as quatro listas de imagem somam no maximo 19', () => {
    assert.deepEqual(problemas('demand_gen', { ad_dg_marketing_images: itens(10), ad_dg_square_marketing_images: itens(9) }), []);
    assert.equal(problemas('demand_gen', { ad_dg_marketing_images: itens(10), ad_dg_square_marketing_images: itens(10) }).length, 1);
  });
});

describe('dependencias do app (Multi Channel)', () => {
  const app = (estrategia: string, meta: string, extras: Record<string, CampoDeMidia['valor']> = {}) => ({
    campaign_app_bidding_strategy: estrategia,
    campaign_app_goal_type: meta,
    ...extras,
  });

  it('meta e estrategia de lance combinam', () => {
    assert.deepEqual(problemas('multi_channel', app('MAXIMIZE_CONVERSIONS', 'OPTIMIZE_INSTALLS_WITHOUT_TARGET_INSTALL_COST')), []);
    assert.deepEqual(problemas('multi_channel', app('TARGET_CPA', 'OPTIMIZE_INSTALLS_TARGET_INSTALL_COST', { campaign_app_target_cpa_micros: 5_000_000 })), []);
    assert.equal(problemas('multi_channel', app('MAXIMIZE_CONVERSIONS', 'OPTIMIZE_INSTALLS_TARGET_INSTALL_COST')).length, 1);
    assert.equal(problemas('multi_channel', app('TARGET_CPA', 'OPTIMIZE_INSTALLS_WITHOUT_TARGET_INSTALL_COST', { campaign_app_target_cpa_micros: 5_000_000 })).length, 1);
  });

  it('CPA alvo e obrigatorio com TARGET_CPA e proibido com MAXIMIZE_CONVERSIONS', () => {
    assert.equal(problemas('multi_channel', app('TARGET_CPA', 'OPTIMIZE_INSTALLS_TARGET_INSTALL_COST')).length, 1);
    assert.equal(problemas('multi_channel', app('MAXIMIZE_CONVERSIONS', 'OPTIMIZE_INSTALLS_WITHOUT_TARGET_INSTALL_COST', { campaign_app_target_cpa_micros: 5_000_000 })).length, 1);
    assert.equal(problemas('multi_channel', app('TARGET_CPA', 'OPTIMIZE_INSTALLS_TARGET_INSTALL_COST', { campaign_app_target_cpa_micros: 0 })).length, 1);
  });

  it('pausa na campanha e no grupo; textos e imagens com limites', () => {
    assert.equal(problemas('multi_channel', { campaign_status: 'ENABLED', adgroup_app_status: 'ENABLED' }).length, 2);
    assert.deepEqual(problemas('multi_channel', { campaign_status: 'PAUSED', adgroup_app_status: 'PAUSED' }), []);
    assert.deepEqual(problemas('multi_channel', { ad_app_headlines: itens(2, 30), ad_app_descriptions: itens(1, 90), ad_app_images: itens(20), ad_app_youtube_videos: itens(1) }), []);
    assert.equal(problemas('multi_channel', { ad_app_headlines: itens(1) }).length, 1);
    assert.equal(problemas('multi_channel', { ad_app_headlines: itens(6) }).length, 1);
    assert.equal(problemas('multi_channel', { ad_app_descriptions: [] }).length, 1);
    assert.equal(problemas('multi_channel', { ad_app_images: itens(21) }).length, 1);
  });

  it('campos de outro canal reprovam no app', () => {
    assert.deepEqual(problemas('multi_channel', { ad_final_url: 'https://x.com' }), ['plano_de_midia/google/ad_final_url (não se aplica ao objetivo multi_channel)']);
    assert.equal(problemas('multi_channel', { campaign_bidding_strategy: 'MANUAL_CPC' }).length, 1);
  });
});

describe('orcamento e micros nos canais', () => {
  it('CUSTOM_PERIOD fora de Search reprova com uma mensagem unica', () => {
    for (const objetivo of ['display', 'performance_max', 'demand_gen', 'multi_channel']) {
      assert.deepEqual(problemas(objetivo, { budget_period: 'CUSTOM_PERIOD' }), [`plano_de_midia/google/budget_period (CUSTOM_PERIOD só vale em Search; use DAILY em ${objetivo})`]);
    }
    assert.deepEqual(problemas('display', { budget_period: 'DAILY' }), []);
    assert.equal(problemas('search', { budget_period: 'CUSTOM_PERIOD' }).length, 1);
    assert.deepEqual(problemas('search', { budget_period: 'CUSTOM_PERIOD', campaign_end_date_time: '2026-12-31 23:59:59' }), []);
  });

  it('micros acima de 1e12 ou inseguros reprovam no orcamento e nos lances', () => {
    assert.deepEqual(problemas('search', { budget_amount_micros: 1e12 }), []);
    assert.equal(problemas('search', { budget_amount_micros: 1e12 + 10_000 }).length, 1);
    assert.equal(problemas('search', { budget_amount_micros: Number.MAX_SAFE_INTEGER + 2 }).length >= 1, true);
    assert.equal(problemas('search', { adgroup_cpc_bid_micros: 2e12 }).length, 1);
    assert.equal(problemas('display', { campaign_display_bidding_strategy: 'TARGET_CPA', campaign_display_target_cpa_micros: 2e12 }).length, 1);
    assert.equal(problemas('display', { adgroup_display_cpc_bid_micros: 1.5, campaign_display_bidding_strategy: 'MANUAL_CPC' }).length, 1);
  });
});

describe('orcamento compartilhado', () => {
  it('true so em Search; false e ausente valem em qualquer canal', () => {
    assert.deepEqual(problemas('search', { budget_explicitly_shared: true }), []);
    for (const objetivo of ['display', 'performance_max', 'demand_gen', 'multi_channel']) {
      assert.deepEqual(problemas(objetivo, { budget_explicitly_shared: false }), [], objetivo);
      assert.deepEqual(problemas(objetivo, { budget_explicitly_shared: true }), [`plano_de_midia/google/budget_explicitly_shared (orçamento compartilhado só foi provado em Search; use false em ${objetivo})`]);
    }
  });
});
