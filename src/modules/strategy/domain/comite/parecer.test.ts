import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { URN_BENCHMARK_B, urnDeTeste } from '../fixturesDeTeste.ts';
import { parecer, ponto } from './fixturesDeParecer.ts';
import { MAXIMO_DE_PONTOS_POR_PARECER, TAMANHO_MAXIMO_DO_PARECER_BYTES, lerParecer, tamanhoDoParecer } from './parecer.ts';

describe('lerParecer', () => {
  it('aceita parecer válido nos três vereditos', () => {
    assert.equal(lerParecer(parecer('redator', 'aprova')).ok, true);
    assert.equal(lerParecer(parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'campanhas/cp_busca', [URN_BENCHMARK_B])])).ok, true);
    assert.equal(lerParecer(parecer('risco_legal', 'reprova', [ponto('p1', 'riscos_e_regras')])).ok, true);
  });

  it('recusa veredito fora do banco, persona fora do padrão e chave extra', () => {
    assert.equal(lerParecer({ ...parecer('redator', 'aprova'), veredito: 'talvez' }).ok, false);
    assert.equal(lerParecer(parecer('Redator Sênior', 'aprova')).ok, false);
    assert.equal(lerParecer({ ...parecer('redator', 'aprova'), extra: 1 }).ok, false);
  });

  it('recusa trecho que não é seção nem item', () => {
    assert.equal(lerParecer(parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'Campanha 1')])).ok, false);
    assert.equal(lerParecer(parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'a/b/c')])).ok, false);
  });

  it('recusa fonte que não é URN', () => {
    assert.equal(lerParecer(parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'campanhas', ['http://x'])])).ok, false);
  });

  it('ajuste ou reprovação exigem ao menos um ponto; ids de ponto não repetem', () => {
    assert.equal(lerParecer(parecer('redator', 'reprova')).ok, false);
    assert.equal(lerParecer(parecer('redator', 'aprova_com_ajuste')).ok, false);
    assert.equal(lerParecer(parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'campanhas'), ponto('p1', 'criativos')])).ok, false);
  });

  it('o máximo é de 5 pontos por parecer', () => {
    assert.equal(MAXIMO_DE_PONTOS_POR_PARECER, 5);
  });

  it('limita pontos e o tamanho total a 16 KB', () => {
    const muitos = Array.from({ length: MAXIMO_DE_PONTOS_POR_PARECER + 1 }, (_, i) => ponto(`p${i}`, 'campanhas'));
    assert.equal(lerParecer(parecer('redator', 'aprova_com_ajuste', muitos)).ok, false);

    const urn = urnDeTeste('conhecimento', 'a'.repeat(160));
    const gordos = Array.from({ length: MAXIMO_DE_PONTOS_POR_PARECER }, (_, i) =>
      ponto(`p${i}`, 'campanhas', Array.from({ length: 10 }, () => urn), { problema: 'x'.repeat(500), ajustePedido: 'y'.repeat(500) }),
    );
    const grande = parecer('redator', 'aprova_com_ajuste', gordos);
    assert.ok(tamanhoDoParecer(grande) > TAMANHO_MAXIMO_DO_PARECER_BYTES);
    assert.equal(lerParecer(grande).ok, false);
  });
});
