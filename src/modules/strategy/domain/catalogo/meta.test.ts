import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { catalogoParaModelo } from './compacto.ts';
import { CATALOGOS_DISPONIVEIS, plataformasComCatalogo } from './disponiveis.ts';
import { catalogoMeta } from './meta.ts';
import { esquemaCatalogoDeCampos } from './tipos.ts';

describe('catalogo de campos da Meta', () => {
  it('respeita o formato do CatalogoDeCampos', () => {
    assert.doesNotThrow(() => esquemaCatalogoDeCampos.parse(catalogoMeta));
  });

  it('cobre os seis objetivos ODAX e os tres niveis', () => {
    assert.equal(catalogoMeta.objetivos.length, 6);
    const secoes = new Set(catalogoMeta.campos.map((campo) => campo.secao));
    for (const secao of ['campaign', 'adset', 'ad', 'creative']) assert.ok(secoes.has(secao));
  });

  it('nao repete chave e so usa opcoes em campo de escolha', () => {
    const chaves = catalogoMeta.campos.map((campo) => campo.chave);
    assert.equal(new Set(chaves).size, chaves.length);
    for (const campo of catalogoMeta.campos) assert.equal(campo.opcoes !== undefined, campo.tipoDoValor === 'escolha');
  });

  it('os campos de destino real tem papel e nunca aceitam a_confirmar', () => {
    const papeis = Object.fromEntries(catalogoMeta.campos.filter((campo) => campo.papel !== undefined).map((campo) => [campo.chave, campo.papel]));
    assert.deepEqual(papeis, { adset_po_whatsapp_phone: 'whatsapp', creative_link: 'url_destino', creative_cta_link: 'url_destino', creative_url_tags: 'utm' });
    assert.ok(catalogoMeta.campos.filter((campo) => campo.papel !== undefined).every((campo) => campo.evidenciaDaApi !== 'nao_verificado_pela_api'));
  });

  it('Meta e Google sao selecionaveis e o objetivo vem de um campo do catalogo', () => {
    assert.deepEqual(plataformasComCatalogo(CATALOGOS_DISPONIVEIS), ['meta', 'google']);
    assert.ok(catalogoMeta.campos.some((campo) => campo.chave === catalogoMeta.campoDoObjetivo));
  });

  it('o catalogo compacto e menor que o completo e preserva todos os campos', () => {
    const compacto = catalogoParaModelo(catalogoMeta);
    assert.ok(JSON.stringify(compacto).length < JSON.stringify(catalogoMeta).length / 2);
    assert.equal(Object.values(compacto.secoes).flat().length, catalogoMeta.campos.length);
  });
});
