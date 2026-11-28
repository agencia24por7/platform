import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../../shared/testing/registrarAlias.mjs';
import { COMITES, comitePorChave, relatoraDoComite } from '../../domain/comite/comites.ts';

const { instrucaoDaMesa1, instrucaoDaMesa2, instrucaoDoMembro } = await import('./mesa.ts');
const { REGRAS_COMUNS } = await import('./regrasComuns.ts');

describe('instruções da mesa', () => {
  it('instrução de membro traz a persona, o propósito do comitê e a regra de parecer independente', () => {
    const cultura = comitePorChave('cultura')!;
    const relatora = relatoraDoComite(cultura);
    const texto = instrucaoDoMembro(cultura, relatora);
    assert.ok(texto.includes(REGRAS_COMUNS));
    assert.ok(texto.includes(relatora.instrucao));
    assert.ok(texto.includes(cultura.proposito));
    assert.match(texto, /Parecer independente/);
    assert.ok(texto.includes(`(${relatora.chave})`));
  });

  it('mesa 1 confronta, mesa 2 fecha; ambas herdam as regras comuns e tratam dados como não confiáveis', () => {
    for (const comite of COMITES) {
      const um = instrucaoDaMesa1(comite);
      const dois = instrucaoDaMesa2(comite);
      for (const texto of [um, dois]) {
        assert.ok(texto.includes(REGRAS_COMUNS), comite.chave);
        assert.match(texto, /DADO não confiável/);
        assert.ok(texto.includes(comite.chave));
      }
      assert.match(um, /Rodada 1, confrontar/);
      assert.match(dois, /Rodada 2, fechar/);
      assert.match(dois, /mesa1/);
    }
  });

  it('só o comitê que obriga ajuste avisa que o debate não afrouxa reprovação', () => {
    const avisam = COMITES.filter((c) => instrucaoDaMesa2(c).includes('não afrouxa reprovação')).map((c) => c.chave);
    assert.deepEqual(avisam, ['risco_legal']);
  });

  it('instruções seguem enxutas', () => {
    for (const comite of COMITES) {
      assert.ok(instrucaoDaMesa2(comite).length < 2500, comite.chave);
      for (const membro of comite.membros) assert.ok(instrucaoDoMembro(comite, membro).length < 2500, membro.chave);
    }
  });
});
