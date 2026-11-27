import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOGOS_DISPONIVEIS } from '../catalogo/disponiveis.ts';
import { campoAplicavel, type CampoDoCatalogo } from '../catalogo/tipos.ts';
import { contextoDeTeste } from '../fixturesDeTeste.ts';
import type { CampoDeMidia } from '../plano.ts';
import { checarCoberturaDoPlanoDeMidia } from './coberturaDoPlanoDeMidia.ts';

const catalogo = CATALOGOS_DISPONIVEIS.find((candidato) => candidato.plataforma === 'google')!;
type Valores = Record<string, CampoDeMidia['valor']>;

const COMUNS: Valores = {
  campaign_status: 'PAUSED',
  campaign_contains_eu_political_advertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
  budget_amount_micros: 10_000_000,
  targeting_location: ['geoTargetConstants/1001773'],
  targeting_language: ['languageConstants/1014'],
};

const IMAGENS = ['assets/imagem-um'];

const DO_CANAL: Record<string, (url: string, sufixo: string) => Valores> = {
  search: (url, sufixo) => ({
    campaign_advertising_channel_type: 'SEARCH', campaign_bidding_strategy: 'MAXIMIZE_CONVERSIONS', adgroup_status: 'PAUSED', ad_status: 'PAUSED',
    ad_headlines: ['Titulo um', 'Titulo dois', 'Titulo tres'], ad_descriptions: ['Descricao um', 'Descricao dois'],
    ad_final_url: url, ad_final_url_suffix: sufixo, campaign_final_url_suffix: sufixo,
  }),
  display: (url, sufixo) => ({
    campaign_advertising_channel_type: 'DISPLAY', campaign_display_bidding_strategy: 'MAXIMIZE_CONVERSIONS', campaign_display_network_content: true,
    adgroup_display_status: 'PAUSED', ad_display_status: 'PAUSED', ad_display_headlines: ['Titulo um'], ad_display_long_headline: 'Titulo longo do anuncio',
    ad_display_descriptions: ['Descricao um'], ad_display_business_name: 'Marca', ad_display_marketing_images: IMAGENS, ad_display_square_marketing_images: ['assets/quadrada-um'],
    ad_display_final_url: url, ad_display_final_url_suffix: sufixo, campaign_display_final_url_suffix: sufixo,
  }),
  performance_max: (url, sufixo) => ({
    campaign_advertising_channel_type: 'PERFORMANCE_MAX', campaign_pmax_bidding_strategy: 'MAXIMIZE_CONVERSIONS', campaign_pmax_brand_guidelines_enabled: false, campaign_pmax_final_url_expansion_automation: 'OPTED_OUT',
    assetgroup_pmax_status: 'PAUSED', assetgroup_pmax_final_urls: url, campaign_pmax_final_url_suffix: sufixo, assetgroup_pmax_business_name: 'Marca',
    assetgroup_pmax_headlines: ['Titulo um', 'Titulo dois', 'Titulo tres'], assetgroup_pmax_long_headlines: ['Titulo longo'], assetgroup_pmax_descriptions: ['Descricao um', 'Descricao dois'],
    assetgroup_pmax_marketing_images: IMAGENS, assetgroup_pmax_square_marketing_images: ['assets/quadrada-um'], assetgroup_pmax_logos: ['assets/logo-um'],
  }),
  demand_gen: (url, sufixo) => ({
    campaign_advertising_channel_type: 'DEMAND_GEN', campaign_dg_bidding_strategy: 'MAXIMIZE_CONVERSIONS', budget_amount_micros: 50_000_000,
    adgroup_dg_status: 'PAUSED', ad_dg_status: 'PAUSED', ad_dg_format: 'MULTI_ASSET', ad_dg_headlines: ['Titulo um'], ad_dg_descriptions: ['Descricao um'],
    ad_dg_business_name: 'Marca', ad_dg_marketing_images: IMAGENS, ad_dg_logo_images: ['assets/logo-um'], ad_dg_final_url: url, ad_dg_final_url_suffix: sufixo,
  }),
  multi_channel: () => ({
    campaign_advertising_channel_type: 'MULTI_CHANNEL', campaign_app_bidding_strategy: 'MAXIMIZE_CONVERSIONS', campaign_app_goal_type: 'OPTIMIZE_INSTALLS_WITHOUT_TARGET_INSTALL_COST',
    campaign_app_id: 'com.exemplo.app', adgroup_app_status: 'PAUSED', ad_app_headlines: ['Titulo um', 'Titulo dois'], ad_app_descriptions: ['Descricao um'],
  }),
};

function valorGenerico(campo: CampoDoCatalogo): CampoDeMidia['valor'] {
  switch (campo.tipoDoValor) {
    case 'texto':
      return `valor de ${campo.chave}`;
    case 'numero':
      return 10_000;
    case 'booleano':
      return true;
    case 'lista':
      return [`item de ${campo.chave}`];
    case 'escolha':
      return campo.opcoes![0]!;
  }
}

function cenario(objetivo: string, ajustes: Valores = {}, urlDoAnuncio?: string) {
  const base = contextoDeTeste();
  const intencao = { ...base.plano.intencao, plataformas: ['google' as const] };
  const utm = intencao.utm!.google!;
  const sufixo = `utm_source=${utm.utm_source}&utm_medium=${utm.utm_medium}&utm_campaign=${utm.utm_campaign}`;
  const valores: Valores = { ...COMUNS, ...DO_CANAL[objetivo]!(urlDoAnuncio ?? intencao.destino!.url, sufixo), ...ajustes };
  const obrigatorios = catalogo.campos.filter((campo) => campo.obrigatorio && campoAplicavel(campo, objetivo));
  const chaves = new Set([...obrigatorios.map((campo) => campo.chave), ...Object.keys(valores)]);
  const porSecao = new Map<string, CampoDeMidia[]>();
  for (const campo of catalogo.campos.filter((candidato) => chaves.has(candidato.chave))) {
    const midia: CampoDeMidia = { campo: campo.chave, valor: valores[campo.chave] ?? valorGenerico(campo), justificativa: 'justificado', evidencias: [] };
    porSecao.set(campo.secao, [...(porSecao.get(campo.secao) ?? []), midia]);
  }
  const foraDoCatalogo = Object.keys(valores).filter((chave) => !catalogo.campos.some((campo) => campo.chave === chave));
  if (foraDoCatalogo.length > 0) {
    porSecao.set('campaign', [...(porSecao.get('campaign') ?? []), ...foraDoCatalogo.map((chave) => ({ campo: chave, valor: valores[chave]!, justificativa: 'justificado', evidencias: [] }))]);
  }
  const secoes = [...porSecao].map(([secao, campos]) => ({ secao, campos }));
  return { ...base, catalogosDeCampos: CATALOGOS_DISPONIVEIS, plano: { ...base.plano, intencao, plano_de_midia: { plataformas: [{ plataforma: 'google' as const, secoes }] } } };
}

const veredito = (objetivo: string, ajustes: Valores = {}, url?: string) => checarCoberturaDoPlanoDeMidia(cenario(objetivo, ajustes, url));

describe('gate de cobertura com o catálogo real do Google, por canal', () => {
  it('a intenção tem WhatsApp e nenhum canal exige papel whatsapp', () => {
    assert.ok(cenario('search').plano.intencao.whatsapp !== undefined);
    assert.ok(catalogo.campos.every((campo) => campo.papel !== 'whatsapp'));
  });

  for (const objetivo of ['search', 'display', 'performance_max', 'demand_gen', 'multi_channel']) {
    it(`plano ${objetivo} completo e coerente aprova`, () => {
      const r = veredito(objetivo);
      assert.deepEqual(r.onde, []);
      assert.equal(r.resultado, 'aprovado');
    });
  }

  it('Display, Performance Max e Demand Gen reprovam com URL de terceiro', () => {
    const campoDaUrl: Record<string, string> = { display: 'ad_display_final_url', performance_max: 'assetgroup_pmax_final_urls', demand_gen: 'ad_dg_final_url' };
    for (const [objetivo, campo] of Object.entries(campoDaUrl)) {
      const r = veredito(objetivo, {}, 'https://terceiro.com/oferta');
      assert.equal(r.resultado, 'reprovado', objetivo);
      assert.ok(r.onde.some((o) => o.includes(`${campo} (difere da landing page`)), objetivo);
    }
  });

  it('UTM adulterada em Display, Performance Max e Demand Gen reprova', () => {
    const campoDaUtm: Record<string, string> = { display: 'ad_display_final_url_suffix', performance_max: 'campaign_pmax_final_url_suffix', demand_gen: 'ad_dg_final_url_suffix' };
    for (const [objetivo, campo] of Object.entries(campoDaUtm)) {
      const r = veredito(objetivo, { [campo]: 'utm_source=inventada' });
      assert.equal(r.resultado, 'reprovado', objetivo);
      assert.ok(r.onde.some((o) => o.includes(`${campo} (UTM difere`)), objetivo);
    }
  });

  it('app aprova sem URL nem UTM e reprova se vier URL ou sufixo', () => {
    assert.equal(veredito('multi_channel').resultado, 'aprovado');
    for (const campo of ['ad_final_url', 'ad_display_final_url', 'campaign_final_url_suffix', 'ad_dg_final_url_suffix']) {
      const r = veredito('multi_channel', { [campo]: 'https://exemplo.com.br/oferta' });
      assert.equal(r.resultado, 'reprovado', campo);
    }
    const r = veredito('multi_channel', { ad_final_url: 'https://exemplo.com.br/oferta' });
    assert.ok(r.onde.some((o) => o.includes('ad_final_url (o objetivo multi_channel não carrega URL nem UTM')));
  });

  it('Search e Display seguem exigindo URL', () => {
    for (const objetivo of ['search', 'display']) {
      const base = cenario(objetivo);
      const secoes = base.plano.plano_de_midia.plataformas[0]!.secoes.map((secao) => ({ ...secao, campos: secao.campos.filter((campo) => campo.campo !== (objetivo === 'search' ? 'ad_final_url' : 'ad_display_final_url')) }));
      const r = checarCoberturaDoPlanoDeMidia({ ...base, plano: { ...base.plano, plano_de_midia: { plataformas: [{ plataforma: 'google', secoes }] } } });
      assert.equal(r.resultado, 'reprovado', objetivo);
      assert.ok(r.onde.some((o) => o.includes('campo obrigatório ausente')), objetivo);
    }
  });

  it('status diferente de PAUSED reprova em cada canal, e o anúncio de app não aceita PAUSED', () => {
    const status: Record<string, string> = { search: 'ad_status', display: 'ad_display_status', performance_max: 'assetgroup_pmax_status', demand_gen: 'ad_dg_status', multi_channel: 'adgroup_app_status' };
    for (const [objetivo, campo] of Object.entries(status)) {
      const r = veredito(objetivo, { [campo]: 'ENABLED' });
      assert.equal(r.resultado, 'reprovado', objetivo);
      assert.ok(r.onde.some((o) => o.includes(`${campo} (o plano cria sempre PAUSED`)), objetivo);
    }
    const r = veredito('multi_channel', { ad_app_status: 'PAUSED' });
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.some((o) => o.includes('ad_app_status (valor fora do tipo escolha)')));
    assert.equal(veredito('multi_channel', { ad_app_status: 'ENABLED' }).resultado, 'aprovado');
  });

  it('campos fora do catálogo reprovam: URL móvel do PMax, nome e logo de campanha, sufixo de campanha do Demand Gen', () => {
    for (const [objetivo, campo, valor] of [
      ['performance_max', 'assetgroup_pmax_final_mobile_urls', ['https://terceiro.com']],
      ['performance_max', 'campaign_pmax_business_name', 'Marca'],
      ['performance_max', 'campaign_pmax_logo', 'assets/logo'],
      ['demand_gen', 'campaign_dg_final_url_suffix', 'utm_source=x'],
    ] as const) {
      const r = veredito(objetivo, { [campo]: typeof valor === 'object' ? [...valor] : valor });
      assert.equal(r.resultado, 'reprovado', campo);
      assert.ok(r.onde.some((o) => o.includes(`${campo} (campo fora do catálogo)`)), campo);
    }
  });

  it('Performance Max sem opt-out da expansao de URL, ou com OPTED_IN, reprova', () => {
    const base = cenario('performance_max');
    const secoes = base.plano.plano_de_midia.plataformas[0]!.secoes.map((secao) => ({ ...secao, campos: secao.campos.filter((campo) => campo.campo !== 'campaign_pmax_final_url_expansion_automation') }));
    const semCampo = checarCoberturaDoPlanoDeMidia({ ...base, plano: { ...base.plano, plano_de_midia: { plataformas: [{ plataforma: 'google', secoes }] } } });
    assert.ok(semCampo.onde.some((o) => o.includes('campaign_pmax_final_url_expansion_automation (campo obrigatório ausente)')));
    const optedIn = veredito('performance_max', { campaign_pmax_final_url_expansion_automation: 'OPTED_IN' });
    assert.equal(optedIn.resultado, 'reprovado');
    assert.ok(optedIn.onde.some((o) => o.includes('campaign_pmax_final_url_expansion_automation (valor fora do tipo escolha)')));
  });

  it('campos removidos do catálogo reprovam: cores e fonte de marca do PMax e URL exibida do Display', () => {
    for (const [objetivo, campo] of [['performance_max', 'campaign_pmax_brand_main_color'], ['performance_max', 'campaign_pmax_brand_accent_color'], ['performance_max', 'campaign_pmax_brand_font'], ['display', 'ad_display_url']] as const) {
      const r = veredito(objetivo, { [campo]: 'x' });
      assert.ok(r.onde.some((o) => o.includes(`${campo} (campo fora do catálogo)`)), campo);
    }
  });

  it('Performance Max com brand guidelines ligado reprova e Demand Gen com UTM só no anúncio aprova', () => {
    const r = veredito('performance_max', { campaign_pmax_brand_guidelines_enabled: true });
    assert.ok(r.onde.some((o) => o.includes('só false foi comprovado')));
    assert.equal(veredito('demand_gen').resultado, 'aprovado');
  });

  it('campo de outro canal presente reprova', () => {
    const r = veredito('display', { ad_headlines: ['a', 'b', 'c'] });
    assert.ok(r.onde.some((o) => o.includes('ad_headlines (não se aplica ao objetivo display)')));
    const app = veredito('multi_channel', { campaign_display_network_content: true });
    assert.ok(app.onde.some((o) => o.includes('não se aplica ao objetivo multi_channel')));
  });
});
