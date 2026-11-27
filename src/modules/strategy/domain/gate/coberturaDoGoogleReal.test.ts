import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOGOS_DISPONIVEIS } from '../catalogo/disponiveis.ts';
import { campoAplicavel, type CampoDoCatalogo } from '../catalogo/tipos.ts';
import { contextoDeTeste } from '../fixturesDeTeste.ts';
import type { CampoDeMidia } from '../plano.ts';
import { checarCoberturaDoPlanoDeMidia } from './coberturaDoPlanoDeMidia.ts';

const catalogo = CATALOGOS_DISPONIVEIS.find((candidato) => candidato.plataforma === 'google')!;

const VALORES_FIXOS: Record<string, CampoDeMidia['valor']> = {
  campaign_advertising_channel_type: 'SEARCH',
  campaign_status: 'PAUSED',
  adgroup_status: 'PAUSED',
  ad_status: 'PAUSED',
  campaign_bidding_strategy: 'MAXIMIZE_CONVERSIONS',
  campaign_contains_eu_political_advertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
  budget_amount_micros: 10_000_000,
  ad_headlines: ['Titulo um', 'Titulo dois', 'Titulo tres'],
  ad_descriptions: ['Descricao um', 'Descricao dois'],
  targeting_location: ['geoTargetConstants/1001773'],
  targeting_language: ['languageConstants/1014'],
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

function cenario(urlDoAnuncio?: string) {
  const base = contextoDeTeste();
  const intencao = { ...base.plano.intencao, plataformas: ['google' as const] };
  const utm = intencao.utm!.google!;
  const sufixo = `utm_source=${utm.utm_source}&utm_medium=${utm.utm_medium}&utm_campaign=${utm.utm_campaign}`;
  const valores: Record<string, CampoDeMidia['valor']> = {
    ...VALORES_FIXOS,
    ad_final_url: urlDoAnuncio ?? intencao.destino!.url,
    ad_final_url_suffix: sufixo,
    campaign_final_url_suffix: sufixo,
  };
  const obrigatorios = catalogo.campos.filter((campo) => campo.obrigatorio && campoAplicavel(campo, 'search'));
  const chaves = new Set([...obrigatorios.map((campo) => campo.chave), ...Object.keys(valores)]);
  const porSecao = new Map<string, CampoDeMidia[]>();
  for (const campo of catalogo.campos.filter((candidato) => chaves.has(candidato.chave))) {
    const midia: CampoDeMidia = { campo: campo.chave, valor: valores[campo.chave] ?? valorGenerico(campo), justificativa: 'justificado', evidencias: [] };
    porSecao.set(campo.secao, [...(porSecao.get(campo.secao) ?? []), midia]);
  }
  const secoes = [...porSecao].map(([secao, campos]) => ({ secao, campos }));
  return { ...base, catalogosDeCampos: CATALOGOS_DISPONIVEIS, plano: { ...base.plano, intencao, plano_de_midia: { plataformas: [{ plataforma: 'google' as const, secoes }] } } };
}

describe('gate de cobertura com o catálogo real do Google', () => {
  it('a intenção tem WhatsApp e o catálogo do Google não tem papel whatsapp', () => {
    assert.ok(cenario().plano.intencao.whatsapp !== undefined);
    assert.ok(catalogo.campos.every((campo) => campo.papel !== 'whatsapp'));
  });

  it('plano Search completo e coerente aprova', () => {
    const r = checarCoberturaDoPlanoDeMidia(cenario());
    assert.deepEqual(r.onde, []);
    assert.equal(r.resultado, 'aprovado');
  });

  it('anúncio com URL diferente da landing page reprova', () => {
    const r = checarCoberturaDoPlanoDeMidia(cenario('https://terceiro.com/oferta'));
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.some((o) => o.includes('ad_final_url (difere da landing page')));
  });
});
