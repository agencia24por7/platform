import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VALOR_A_CONFIRMAR } from '../catalogo/tipos.ts';
import type { CampoDeMidia } from '../plano.ts';
import { catalogoGoogle } from '../catalogo/google.ts';
import { contextoDeTeste } from '../fixturesDeTeste.ts';
import { analisarPlataforma } from './coberturaDoPlanoDeMidia.ts';
import { problemasDeDependenciaDoGoogle } from './dependenciasDoGoogle.ts';

const local = (chave: string) => `plano_de_midia/google/${chave}`;
const problemas = (campos: Record<string, CampoDeMidia['valor']>, objetivo: string | undefined = 'search') =>
  problemasDeDependenciaDoGoogle(new Map(Object.entries(campos)), objetivo, local, catalogoGoogle);
const itens = (quantidade: number, tamanho = 10) => Array.from({ length: quantidade }, (_, i) => `${String(i).padStart(2, '0')}${'x'.repeat(tamanho - 2)}`);

describe('dependencias do Google Ads', () => {
  it('plano sem campos dependentes passa', () => {
    assert.deepEqual(problemas({}), []);
  });

  it('CPA alvo exige MAXIMIZE_CONVERSIONS ou TARGET_CPA', () => {
    assert.equal(problemas({ campaign_target_cpa_micros: 10000000, campaign_bidding_strategy: 'MANUAL_CPC' }).length, 1);
    assert.equal(problemas({ campaign_target_cpa_micros: 10000000 }).length, 1);
    assert.deepEqual(problemas({ campaign_target_cpa_micros: 10000000, campaign_bidding_strategy: 'MAXIMIZE_CONVERSIONS' }), []);
    assert.deepEqual(problemas({ campaign_target_cpa_micros: 10000000, campaign_bidding_strategy: 'TARGET_CPA' }), []);
  });

  it('CPA alvo de Search e campo de outro canal em Display, Demand Gen e app', () => {
    for (const objetivo of ['display', 'demand_gen', 'multi_channel']) {
      const achados = problemas({ campaign_target_cpa_micros: 10000000, campaign_bidding_strategy: 'MAXIMIZE_CONVERSIONS' }, objetivo);
      assert.ok(achados.includes(`plano_de_midia/google/campaign_target_cpa_micros (não se aplica ao objetivo ${objetivo})`));
    }
  });

  it('ROAS alvo exige MAXIMIZE_CONVERSION_VALUE ou TARGET_ROAS', () => {
    assert.equal(problemas({ campaign_target_roas: 3, campaign_bidding_strategy: 'MAXIMIZE_CONVERSIONS' }).length, 1);
    assert.equal(problemas({ campaign_target_roas: 3 }).length, 1);
    assert.deepEqual(problemas({ campaign_target_roas: 3, campaign_bidding_strategy: 'MAXIMIZE_CONVERSION_VALUE' }), []);
    assert.deepEqual(problemas({ campaign_target_roas: 3, campaign_bidding_strategy: 'TARGET_ROAS' }), []);
  });

  it('a_confirmar na estrategia nao libera o CPA alvo', () => {
    assert.equal(problemas({ campaign_target_cpa_micros: 10000000, campaign_bidding_strategy: VALOR_A_CONFIRMAR }).length, 1);
  });

  it('status so aceita PAUSED na criacao', () => {
    assert.deepEqual(problemas({ campaign_status: 'PAUSED', adgroup_status: 'PAUSED', ad_status: 'PAUSED' }), []);
    const achados = problemas({ campaign_status: 'ENABLED', adgroup_status: 'REMOVED', ad_status: 'PAUSED' });
    assert.equal(achados.length, 2);
    assert.ok(achados[0]!.startsWith('plano_de_midia/google/campaign_status (o plano cria sempre PAUSED'));
  });

  it('titulos: de 3 a 15 itens de ate 30 caracteres, sem repetir', () => {
    assert.deepEqual(problemas({ ad_headlines: itens(3, 30) }), []);
    assert.deepEqual(problemas({ ad_headlines: itens(15) }), []);
    assert.deepEqual(problemas({ ad_headlines: itens(2) }), ['plano_de_midia/google/ad_headlines (de 3 a 15 itens; veio 2)']);
    assert.deepEqual(problemas({ ad_headlines: itens(16) }), ['plano_de_midia/google/ad_headlines (de 3 a 15 itens; veio 16)']);
    assert.deepEqual(problemas({ ad_headlines: [...itens(2), 'x'.repeat(31)] }), ['plano_de_midia/google/ad_headlines (1 item(ns) com mais de 30 caracteres)']);
    assert.deepEqual(problemas({ ad_headlines: ['Igual', 'igual', 'Outro'] }), ['plano_de_midia/google/ad_headlines (itens repetidos; a API recusa DUPLICATE_ASSET)']);
  });

  it('descricoes: de 2 a 4 itens de ate 90 caracteres', () => {
    assert.deepEqual(problemas({ ad_descriptions: itens(2, 90) }), []);
    assert.deepEqual(problemas({ ad_descriptions: itens(4) }), []);
    assert.deepEqual(problemas({ ad_descriptions: itens(1) }), ['plano_de_midia/google/ad_descriptions (de 2 a 4 itens; veio 1)']);
    assert.deepEqual(problemas({ ad_descriptions: itens(5) }), ['plano_de_midia/google/ad_descriptions (de 2 a 4 itens; veio 5)']);
    assert.deepEqual(problemas({ ad_descriptions: [...itens(1), 'y'.repeat(91)] }), ['plano_de_midia/google/ad_descriptions (1 item(ns) com mais de 90 caracteres)']);
  });

  it('path1 e path2: ate 15 caracteres e path2 exige path1', () => {
    assert.deepEqual(problemas({ ad_path1: 'a'.repeat(15), ad_path2: 'b'.repeat(15) }), []);
    assert.deepEqual(problemas({ ad_path1: 'a'.repeat(16) }), ['plano_de_midia/google/ad_path1 (mais de 15 caracteres)']);
    assert.deepEqual(problemas({ ad_path1: 'a', ad_path2: 'b'.repeat(16) }), ['plano_de_midia/google/ad_path2 (mais de 15 caracteres)']);
    assert.deepEqual(problemas({ ad_path2: 'b' }), ['plano_de_midia/google/ad_path1 (obrigatório com ad_path2)']);
  });

  it('orcamento: entrega ACCELERATED recusada e periodo CUSTOM_PERIOD exige data final', () => {
    assert.deepEqual(problemas({ budget_delivery_method: 'STANDARD', budget_period: 'DAILY' }), []);
    assert.equal(problemas({ budget_delivery_method: 'ACCELERATED' }).length, 1);
    assert.equal(problemas({ budget_period: 'CUSTOM_PERIOD' }).length, 1);
    assert.deepEqual(problemas({ budget_period: 'CUSTOM_PERIOD', campaign_end_date_time: '2026-12-31 23:59:59' }), []);
  });

  it('rede de pesquisa do Google precisa ficar ligada em Search', () => {
    assert.equal(problemas({ campaign_network_google_search: false }).length, 1);
    assert.deepEqual(problemas({ campaign_network_google_search: true, campaign_network_search_partners: false }), []);
  });

  it('campo de estrategia so passa com a estrategia dele', () => {
    assert.equal(problemas({ campaign_target_impression_share_location: 'TOP_OF_PAGE', campaign_bidding_strategy: 'MANUAL_CPC' }).length, 1);
    assert.equal(problemas({ campaign_target_impression_share_fraction_micros: 500000 }).length, 1);
    assert.deepEqual(problemas({ campaign_target_impression_share_fraction_micros: 500000, campaign_bidding_strategy: 'TARGET_IMPRESSION_SHARE', campaign_target_impression_share_location: 'TOP_OF_PAGE' }), []);
    assert.equal(problemas({ campaign_cpc_bid_ceiling_micros: 1000000, campaign_bidding_strategy: 'MANUAL_CPC' }).length, 1);
    assert.deepEqual(problemas({ campaign_cpc_bid_ceiling_micros: 1000000, campaign_bidding_strategy: 'TARGET_SPEND' }), []);
    assert.deepEqual(problemas({ campaign_cpc_bid_ceiling_micros: 1000000, campaign_bidding_strategy: 'TARGET_IMPRESSION_SHARE', campaign_target_impression_share_location: 'TOP_OF_PAGE', campaign_target_impression_share_fraction_micros: 1000000 }), []);
    assert.equal(problemas({ campaign_manual_cpc_enhanced: false, campaign_bidding_strategy: 'MAXIMIZE_CONVERSIONS' }).length, 1);
    assert.deepEqual(problemas({ campaign_manual_cpc_enhanced: false, campaign_bidding_strategy: 'MANUAL_CPC' }), []);
    assert.equal(problemas({ campaign_manual_cpc_enhanced: true, campaign_bidding_strategy: 'MANUAL_CPC' }).length, 1);
  });

  it('campo presente fora do objetivo reprova no Google', () => {
    const catalogo = { ...catalogoGoogle, objetivos: ['search', 'display'], campos: [...catalogoGoogle.campos, { chave: 'so_display', secao: 'campaign', obrigatorio: false, aplicavelA: ['display'], tipoDoValor: 'texto' as const }] };
    const achados = problemasDeDependenciaDoGoogle(new Map([['so_display', 'x']]), 'search', local, catalogo);
    assert.deepEqual(achados, ['plano_de_midia/google/so_display (não se aplica ao objetivo search)']);
    assert.deepEqual(problemasDeDependenciaDoGoogle(new Map([['so_display', 'x']]), 'display', local, catalogo), []);
  });

  it('micros inteiros e multiplos, ROAS e modificador de dispositivo com faixa', () => {
    assert.equal(problemas({ adgroup_cpc_bid_micros: 1500.5 }).length, 1);
    assert.equal(problemas({ keyword_cpc_bid_micros: 10001 }).length, 1);
    assert.equal(problemas({ campaign_target_impression_share_fraction_micros: 500000.5, campaign_bidding_strategy: 'TARGET_IMPRESSION_SHARE', campaign_target_impression_share_location: 'TOP_OF_PAGE' }).length, 1);
    assert.equal(problemas({ campaign_target_roas: 1001, campaign_bidding_strategy: 'TARGET_ROAS' }).length, 1);
    assert.deepEqual(problemas({ campaign_target_roas: 1000, campaign_bidding_strategy: 'TARGET_ROAS', targeting_device_bid_modifier: 0.5 }), []);
    assert.equal(problemas({ targeting_device_bid_modifier: -0.1 }).length, 1);
    assert.equal(problemas({ targeting_device_bid_modifier: 10.1 }).length, 1);
    assert.deepEqual(problemas({ targeting_device_bid_modifier: 0 }), []);
  });

  it('datas validadas no calendario', () => {
    assert.deepEqual(problemas({ campaign_start_date_time: '2028-02-29 23:59:59' }), []);
    for (const invalida of ['2026-02-29 00:00:00', '2026-13-01 00:00:00', '2026-04-31 00:00:00', '2026-01-01 24:00:00', '2026-01-01 10:60:00', '2026-01-01 10:00:60', '2026-00-10 00:00:00']) {
      assert.equal(problemas({ campaign_start_date_time: invalida }).length, 1, invalida);
    }
    assert.equal(problemas({ campaign_start_date_time: '2026-02-30 00:00:00', campaign_end_date_time: '2026-03-01 00:00:00' }).length, 1);
  });

  it('estrategia de participacao exige local e fracao em micros de 1 a 1.000.000', () => {
    assert.equal(problemas({ campaign_bidding_strategy: 'TARGET_IMPRESSION_SHARE' }).length, 2);
    assert.deepEqual(problemas({ campaign_bidding_strategy: 'TARGET_IMPRESSION_SHARE', campaign_target_impression_share_location: 'TOP_OF_PAGE', campaign_target_impression_share_fraction_micros: 500000 }), []);
    assert.equal(problemas({ campaign_bidding_strategy: 'TARGET_IMPRESSION_SHARE', campaign_target_impression_share_location: 'TOP_OF_PAGE', campaign_target_impression_share_fraction_micros: 0 }).length, 1);
    assert.equal(problemas({ campaign_bidding_strategy: 'TARGET_IMPRESSION_SHARE', campaign_target_impression_share_location: 'TOP_OF_PAGE', campaign_target_impression_share_fraction_micros: 1000001 }).length, 1);
    assert.deepEqual(problemas({ campaign_bidding_strategy: 'TARGET_IMPRESSION_SHARE', campaign_target_impression_share_location: 'TOP_OF_PAGE', campaign_target_impression_share_fraction_micros: 1000000 }), []);
  });

  it('orcamento e lances em micros maiores que 0; orcamento multiplo de 10000', () => {
    assert.deepEqual(problemas({ budget_amount_micros: 10000000, adgroup_cpc_bid_micros: 1000000, keyword_cpc_bid_micros: 500000, campaign_cpc_bid_ceiling_micros: 10000, campaign_bidding_strategy: 'TARGET_SPEND' }), []);
    assert.equal(problemas({ budget_amount_micros: 0 }).length, 1);
    assert.equal(problemas({ budget_amount_micros: 10000001 }).length, 1);
    assert.equal(problemas({ adgroup_cpc_bid_micros: 0, keyword_cpc_bid_micros: -5, campaign_cpc_bid_ceiling_micros: 0, campaign_bidding_strategy: 'TARGET_SPEND' }).length, 3);
    assert.equal(problemas({ campaign_target_roas: 0, campaign_bidding_strategy: 'TARGET_ROAS' }).length, 1);
  });

  it('CPA alvo em micros precisa ser maior que 0', () => {
    for (const cpa of [0, -10000]) {
      const achados = problemas({ campaign_target_cpa_micros: cpa, campaign_bidding_strategy: 'MAXIMIZE_CONVERSIONS' });
      assert.ok(achados.includes('plano_de_midia/google/campaign_target_cpa_micros (micros da moeda da conta; precisa ser maior que 0)'));
    }
  });

  it('programacao: horas de 0 a 24 com inicio antes do fim', () => {
    assert.deepEqual(problemas({ targeting_ad_schedule_start_hour: 0, targeting_ad_schedule_end_hour: 24 }), []);
    assert.equal(problemas({ targeting_ad_schedule_start_hour: 9, targeting_ad_schedule_end_hour: 9 }).length, 1);
    assert.equal(problemas({ targeting_ad_schedule_start_hour: 18, targeting_ad_schedule_end_hour: 9 }).length, 1);
    assert.equal(problemas({ targeting_ad_schedule_start_hour: -1, targeting_ad_schedule_end_hour: 25 }).length, 2);
    assert.equal(problemas({ targeting_ad_schedule_start_hour: 9.5 }).length, 1);
  });

  it('datas no formato yyyy-MM-dd HH:mm:ss e inicio antes do fim', () => {
    assert.deepEqual(problemas({ campaign_start_date_time: '2026-12-01 00:00:00', campaign_end_date_time: '2026-12-31 23:59:59' }), []);
    assert.equal(problemas({ campaign_start_date_time: '2026-12-01' }).length, 1);
    assert.equal(problemas({ campaign_end_date_time: '01/12/2026' }).length, 1);
    assert.equal(problemas({ campaign_start_date_time: '2026-12-31 00:00:00', campaign_end_date_time: '2026-12-01 00:00:00' }).length, 1);
  });

  it('o gate aplica as dependencias so na plataforma Google', () => {
    const intencao = contextoDeTeste().plano.intencao;
    const campo = (nome: string, valor: CampoDeMidia['valor']) => ({ campo: nome, valor, justificativa: 'j', evidencias: [] });
    const entrada = {
      plataforma: 'google' as const,
      secoes: [{ secao: 'campaign', campos: [campo('campaign_advertising_channel_type', 'SEARCH'), campo('campaign_target_cpa_micros', 10), campo('campaign_bidding_strategy', 'MANUAL_CPC')] }],
    };
    const { problemas: achados } = analisarPlataforma(entrada, catalogoGoogle, intencao);
    assert.ok(achados.some((p) => p.includes('MAXIMIZE_CONVERSIONS ou TARGET_CPA é obrigatório')));
  });

  it('o gate reprova campo que nao se aplica ao objetivo, destino ausente e tracking removido', () => {
    const intencao = contextoDeTeste().plano.intencao;
    const campo = (nome: string, valor: CampoDeMidia['valor']) => ({ campo: nome, valor, justificativa: 'j', evidencias: [] });
    const entrada = (extras: CampoDeMidia[]) => ({
      plataforma: 'google' as const,
      secoes: [{ secao: 'campaign', campos: [campo('campaign_advertising_channel_type', 'SEARCH'), ...extras] }],
    });
    const achados = analisarPlataforma(entrada([campo('campaign_tracking_url_template', 'https://x.com')]), catalogoGoogle, intencao).problemas;
    assert.ok(achados.some((p) => p.includes('campaign_tracking_url_template (campo fora do catálogo)')));
    assert.ok(achados.some((p) => p.includes('ad_final_url (campo obrigatório ausente)')));
    const comObjetivoErrado = analisarPlataforma(entrada([]), { ...catalogoGoogle, objetivos: ['search', 'display'], campos: [...catalogoGoogle.campos, { chave: 'so_display', secao: 'campaign', obrigatorio: false, aplicavelA: ['display'], tipoDoValor: 'texto' }] }, intencao).problemas;
    assert.ok(!comObjetivoErrado.some((p) => p.includes('so_display')));
    const naoAplica = analisarPlataforma(
      { plataforma: 'google', secoes: [{ secao: 'campaign', campos: [campo('campaign_advertising_channel_type', 'SEARCH'), campo('so_display', 'x')] }] },
      { ...catalogoGoogle, objetivos: ['search', 'display'], campos: [...catalogoGoogle.campos, { chave: 'so_display', secao: 'campaign', obrigatorio: false, aplicavelA: ['display'], tipoDoValor: 'texto' }] },
      intencao,
    ).problemas;
    assert.ok(naoAplica.some((p) => p.includes('so_display (não se aplica ao objetivo search)')));
  });

  it('sem campo de destino aplicavel ao objetivo, o gate reprova', () => {
    const intencao = contextoDeTeste().plano.intencao;
    const semDestino = { ...catalogoGoogle, campos: catalogoGoogle.campos.filter((c) => c.papel !== 'url_destino') };
    const campo = { campo: 'campaign_advertising_channel_type', valor: 'SEARCH', justificativa: 'j', evidencias: [] };
    const { problemas: achados } = analisarPlataforma({ plataforma: 'google', secoes: [{ secao: 'campaign', campos: [campo] }] }, semDestino, intencao);
    assert.ok(achados.some((p) => p.includes('não tem campo aplicável ao objetivo com papel url_destino')));
  });
});
