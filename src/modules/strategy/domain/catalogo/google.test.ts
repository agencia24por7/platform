import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { catalogoParaModelo } from './compacto.ts';
import { CATALOGOS_DISPONIVEIS, plataformasComCatalogo } from './disponiveis.ts';
import { catalogoGoogle } from './google.ts';
import { campoAplicavel, campoNaoVerificado, esquemaCatalogoDeCampos, objetivoDoValor } from './tipos.ts';

const campoDe = (chave: string) => catalogoGoogle.campos.find((campo) => campo.chave === chave)!;
const comPapel = (papel: string) => catalogoGoogle.campos.filter((campo) => campo.papel === papel);
const chavesDoCanal = (objetivo: string) => catalogoGoogle.campos.filter((campo) => campo.aplicavelA?.length === 1 && campo.aplicavelA[0] === objetivo);

describe('catalogo de campos do Google Ads', () => {
  it('respeita o formato do CatalogoDeCampos e esta nos disponiveis', () => {
    assert.doesNotThrow(() => esquemaCatalogoDeCampos.parse(catalogoGoogle));
    assert.ok(plataformasComCatalogo(CATALOGOS_DISPONIVEIS).includes('google'));
    assert.equal(catalogoGoogle.plataforma, 'google');
    assert.equal(catalogoGoogle.versaoDaApi, 'v26');
    assert.ok(catalogoGoogle.campos.length <= 600);
  });

  it('o objetivo e o tipo de canal; cada opcao do enum vira um objetivo declarado', () => {
    assert.equal(catalogoGoogle.campoDoObjetivo, 'campaign_advertising_channel_type');
    assert.deepEqual(catalogoGoogle.objetivos, ['search', 'display', 'performance_max', 'demand_gen', 'multi_channel']);
    assert.deepEqual(campoDe(catalogoGoogle.campoDoObjetivo).opcoes!.map(objetivoDoValor), catalogoGoogle.objetivos);
  });

  it('Shopping fica de fora e so app nao carrega destino', () => {
    assert.ok(!catalogoGoogle.objetivos.includes('shopping'));
    assert.ok(!campoDe(catalogoGoogle.campoDoObjetivo).opcoes!.includes('SHOPPING'));
    assert.ok(catalogoGoogle.campos.every((campo) => !campo.chave.includes('shopping')));
    assert.deepEqual(catalogoGoogle.objetivosSemDestino, ['multi_channel']);
  });

  it('cobre campanha, orcamento, grupo, palavra, anuncio, asset group e segmentacao', () => {
    const secoes = new Set(catalogoGoogle.campos.map((campo) => campo.secao));
    for (const secao of ['campaign', 'budget', 'adgroup', 'keyword', 'ad', 'targeting', 'assetgroup']) assert.ok(secoes.has(secao));
  });

  it('nao tem os campos excluidos e nao repete chave', () => {
    const chaves = catalogoGoogle.campos.map((campo) => campo.chave);
    assert.equal(new Set(chaves).size, chaves.length);
    const excluidos = [
      'ad_final_urls', 'ad_final_mobile_urls', 'campaign_pmax_final_url_expansion',
      'campaign_tracking_url_template', 'adgroup_tracking_url_template', 'ad_tracking_url_template', 'ad_url_custom_parameters',
      'campaign_shopping_merchant_id', 'campaign_advertising_channel_sub_type', 'campaign_pmax_brand_guidelines',
      'ad_dg_carousel_cards', 'ad_dg_call_to_action_text', 'budget_dg_amount_micros', 'assetgroup_pmax_final_mobile_urls', 'campaign_pmax_business_name', 'campaign_pmax_logo', 'campaign_dg_final_url_suffix', 'campaign_pmax_brand_main_color', 'campaign_pmax_brand_accent_color', 'campaign_pmax_brand_font', 'ad_display_url', 'ad_display_main_color', 'ad_display_accent_color',
      'campaign_display_channel_type', 'campaign_pmax_channel_type', 'campaign_dg_channel_type', 'campaign_app_channel_type',
    ];
    for (const excluido of excluidos) assert.ok(!chaves.includes(excluido), excluido);
  });

  it('so campo de escolha tem opcoes; status e app com as opcoes reais da API', () => {
    for (const campo of catalogoGoogle.campos) assert.equal(campo.opcoes !== undefined, campo.tipoDoValor === 'escolha');
    for (const status of ['campaign_status', 'adgroup_status', 'ad_status', 'adgroup_display_status', 'ad_display_status', 'assetgroup_pmax_status', 'adgroup_dg_status', 'ad_dg_status', 'adgroup_app_status']) {
      assert.deepEqual(campoDe(status).opcoes, ['ENABLED', 'PAUSED', 'REMOVED']);
    }
    assert.deepEqual(campoDe('ad_app_status').opcoes, ['ENABLED']);
    assert.equal(campoDe('ad_app_status').obrigatorio, false);
    assert.deepEqual(campoDe('campaign_app_store').opcoes, ['GOOGLE_APP_STORE']);
  });

  it('os papeis de destino e UTM existem por canal e nunca aceitam a_confirmar', () => {
    const papeis = Object.fromEntries(catalogoGoogle.campos.filter((campo) => campo.papel !== undefined).map((campo) => [campo.chave, campo.papel]));
    assert.deepEqual(papeis, {
      campaign_final_url_suffix: 'utm', keyword_final_url: 'url_destino', ad_final_url: 'url_destino', ad_final_url_suffix: 'utm',
      campaign_display_final_url_suffix: 'utm', ad_display_final_url: 'url_destino', ad_display_final_url_suffix: 'utm',
      campaign_pmax_final_url_suffix: 'utm', assetgroup_pmax_final_urls: 'url_destino',
      ad_dg_final_url: 'url_destino', ad_dg_final_url_suffix: 'utm',
    });
    for (const objetivo of ['search', 'display', 'performance_max', 'demand_gen']) {
      assert.ok(comPapel('url_destino').some((campo) => campo.obrigatorio && campoAplicavel(campo, objetivo)), objetivo);
    }
    assert.ok(catalogoGoogle.campos.filter((campo) => campo.papel !== undefined).every((campo) => !campoNaoVerificado(campo)));
  });

  it('o app nao tem campo de URL nem de UTM aplicavel', () => {
    for (const campo of [...comPapel('url_destino'), ...comPapel('utm')]) assert.equal(campoAplicavel(campo, 'multi_channel'), false, campo.chave);
  });

  it('Performance Max exige o opt-out da expansao de URL final, com a unica opcao OPTED_OUT', () => {
    const campo = campoDe('campaign_pmax_final_url_expansion_automation');
    assert.equal(campo.obrigatorio, true);
    assert.deepEqual(campo.aplicavelA, ['performance_max']);
    assert.deepEqual(campo.opcoes, ['OPTED_OUT']);
  });

  it('nenhum campo fica nao verificado', () => {
    assert.deepEqual(catalogoGoogle.campos.filter(campoNaoVerificado), []);
  });

  it('o esquema recusa catalogo com campo de URL aplicavel a objetivo sem destino', () => {
    const quebrado = { ...catalogoGoogle, campos: catalogoGoogle.campos.map((campo) => (campo.chave === 'ad_final_url' ? { ...campo, aplicavelA: ['search', 'multi_channel'] } : campo)) };
    assert.throws(() => esquemaCatalogoDeCampos.parse(quebrado));
    assert.throws(() => esquemaCatalogoDeCampos.parse({ ...catalogoGoogle, objetivosSemDestino: ['shopping'] }));
  });

  it('valores monetarios tem a unidade na chave', () => {
    const monetarios = catalogoGoogle.campos.filter((campo) => /(cpa|cpc|cpm|amount|ceiling)/.test(campo.chave) && campo.tipoDoValor === 'numero');
    assert.ok(monetarios.length >= 10);
    for (const campo of monetarios) assert.ok(campo.chave.endsWith('_micros'), campo.chave);
  });

  it('a aplicabilidade segue o canal e cada canal tem campos proprios', () => {
    assert.equal(campoAplicavel(campoDe('ad_headlines'), 'search'), true);
    assert.equal(campoAplicavel(campoDe('ad_headlines'), 'display'), false);
    assert.equal(campoAplicavel(campoDe('campaign_name'), 'multi_channel'), true);
    assert.equal(campoAplicavel(campoDe('adgroup_name'), 'performance_max'), false);
    assert.equal(campoAplicavel(campoDe('campaign_bidding_strategy'), 'display'), false);
    for (const objetivo of ['display', 'performance_max', 'demand_gen', 'multi_channel']) assert.ok(chavesDoCanal(objetivo).length >= 10, objetivo);
  });

  it('o catalogo compacto preserva todos os campos', () => {
    const compacto = catalogoParaModelo(catalogoGoogle);
    assert.equal(Object.values(compacto.secoes).flat().length, catalogoGoogle.campos.length);
  });
});
