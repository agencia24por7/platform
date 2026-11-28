import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOGOS_DISPONIVEIS } from '../catalogo/disponiveis.ts';
import { CAMPOS_DE_CRIATIVO, especificacaoParaModelo, especificacoesDaPlataforma } from './especificacoes.ts';

describe('especificações de criativo derivadas do catálogo da plataforma', () => {
  it('todo campo de criativo existe no catálogo da sua plataforma', () => {
    for (const [plataforma, campos] of Object.entries(CAMPOS_DE_CRIATIVO)) {
      const catalogo = CATALOGOS_DISPONIVEIS.find((item) => item.plataforma === plataforma);
      assert.ok(catalogo, plataforma);
      for (const campo of campos ?? []) assert.ok(catalogo.campos.some((item) => item.chave === campo.campo), `${plataforma}:${campo.campo}`);
      assert.equal(especificacoesDaPlataforma(plataforma as 'meta' | 'google')?.length, campos?.length);
    }
  });

  it('o Google traz os limites de peças e caracteres do gate e as proporções do ADR 0069', () => {
    const google = new Map((especificacoesDaPlataforma('google') ?? []).map((item) => [item.campo, item]));
    assert.deepEqual(
      { pecas: google.get('ad_headlines')?.maximoDePecas, caracteres: google.get('ad_headlines')?.caracteres },
      { pecas: 15, caracteres: 30 },
    );
    assert.equal(google.get('ad_display_business_name')?.caracteres, 25);
    assert.equal(google.get('ad_display_business_name')?.maximoDePecas, 1);
    assert.equal(google.get('ad_display_marketing_images')?.proporcao, '1.91:1');
    assert.equal(google.get('ad_dg_portrait_marketing_images')?.proporcao, null);
    assert.equal(especificacaoParaModelo(google.get('ad_headlines')!), 'ad_headlines:textox15<=30c');
  });

  it('a Meta não tem limite inventado e plataforma sem catálogo devolve nulo', () => {
    const meta = especificacoesDaPlataforma('meta') ?? [];
    assert.ok(meta.length > 0);
    assert.ok(meta.every((item) => item.caracteres === null && item.proporcao === null));
    assert.equal(especificacoesDaPlataforma('tiktok'), null);
  });
});
