import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { catalogoParaModelo } from './compacto.ts';
import { CATALOGOS_DISPONIVEIS, plataformasComCatalogo } from './disponiveis.ts';
import { catalogoGoogle } from './google.ts';
import { campoAplicavel, campoNaoVerificado, esquemaCatalogoDeCampos, objetivoDoValor } from './tipos.ts';

const campoDe = (chave: string) => catalogoGoogle.campos.find((campo) => campo.chave === chave)!;

describe('catalogo de campos do Google Ads', () => {
  it('respeita o formato do CatalogoDeCampos e esta nos disponiveis', () => {
    assert.doesNotThrow(() => esquemaCatalogoDeCampos.parse(catalogoGoogle));
    assert.ok(plataformasComCatalogo(CATALOGOS_DISPONIVEIS).includes('google'));
    assert.equal(catalogoGoogle.plataforma, 'google');
    assert.equal(catalogoGoogle.versaoDaApi, 'v26');
  });

  it('o objetivo e o tipo de canal e so Search tem anuncio comprovado', () => {
    assert.equal(catalogoGoogle.campoDoObjetivo, 'campaign_advertising_channel_type');
    assert.deepEqual(catalogoGoogle.objetivos, ['search']);
    const opcoes = campoDe(catalogoGoogle.campoDoObjetivo).opcoes!;
    assert.deepEqual(opcoes.map(objetivoDoValor), catalogoGoogle.objetivos);
  });

  it('cobre campanha, orcamento, grupo, palavra, anuncio e segmentacao', () => {
    const secoes = new Set(catalogoGoogle.campos.map((campo) => campo.secao));
    for (const secao of ['campaign', 'budget', 'adgroup', 'keyword', 'ad', 'targeting']) assert.ok(secoes.has(secao));
  });

  it('nao tem os campos excluidos e nao repete chave', () => {
    const chaves = catalogoGoogle.campos.map((campo) => campo.chave);
    assert.equal(new Set(chaves).size, chaves.length);
    const excluidos = ['ad_final_urls', 'ad_final_mobile_urls', 'campaign_pmax_final_url_expansion', 'campaign_tracking_url_template', 'adgroup_tracking_url_template', 'ad_tracking_url_template', 'ad_url_custom_parameters', 'campaign_shopping_merchant_id', 'campaign_app_id', 'campaign_advertising_channel_sub_type', 'campaign_pmax_brand_guidelines'];
    for (const excluido of excluidos) assert.ok(!chaves.includes(excluido), excluido);
  });

  it('so campo de escolha tem opcoes e os status trazem as opcoes reais da API', () => {
    for (const campo of catalogoGoogle.campos) assert.equal(campo.opcoes !== undefined, campo.tipoDoValor === 'escolha');
    for (const status of ['campaign_status', 'adgroup_status', 'ad_status']) assert.deepEqual(campoDe(status).opcoes, ['ENABLED', 'PAUSED', 'REMOVED']);
  });

  it('os papeis de destino e UTM existem e nunca aceitam a_confirmar', () => {
    const papeis = Object.fromEntries(catalogoGoogle.campos.filter((campo) => campo.papel !== undefined).map((campo) => [campo.chave, campo.papel]));
    assert.deepEqual(papeis, { campaign_final_url_suffix: 'utm', keyword_final_url: 'url_destino', ad_final_url: 'url_destino', ad_final_url_suffix: 'utm' });
    assert.equal(campoDe('ad_final_url').obrigatorio, true);
    assert.ok(catalogoGoogle.campos.filter((campo) => campo.papel !== undefined).every((campo) => !campoNaoVerificado(campo)));
  });

  it('nenhum campo fica nao verificado e todo aplicavelA cita so search', () => {
    assert.deepEqual(catalogoGoogle.campos.filter(campoNaoVerificado), []);
    assert.ok(catalogoGoogle.campos.every((campo) => (campo.aplicavelA ?? ['search']).every((objetivo) => objetivo === 'search')));
  });

  it('valores monetarios tem a unidade na chave', () => {
    for (const chave of ['budget_amount_micros', 'adgroup_cpc_bid_micros', 'keyword_cpc_bid_micros', 'campaign_cpc_bid_ceiling_micros', 'campaign_target_cpa_micros']) assert.equal(campoDe(chave).tipoDoValor, 'numero');
  });

  it('a aplicabilidade segue o canal', () => {
    assert.equal(campoAplicavel(campoDe('ad_headlines'), 'search'), true);
    assert.equal(campoAplicavel(campoDe('ad_headlines'), 'display'), false);
    assert.equal(campoAplicavel(campoDe('campaign_name'), undefined), true);
    assert.equal(campoAplicavel(campoDe('campaign_manual_cpc_enhanced'), undefined), false);
  });

  it('o catalogo compacto preserva todos os campos', () => {
    const compacto = catalogoParaModelo(catalogoGoogle);
    assert.equal(Object.values(compacto.secoes).flat().length, catalogoGoogle.campos.length);
  });
});
