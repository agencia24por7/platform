import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PADRAO_DA_CHAVE_DA_PERSONA, PERSONAS, personaPorChave } from './personas.ts';

describe('personas do Comitê', () => {
  it('são as nove do ADR 0062 §6', () => {
    assert.deepEqual(
      PERSONAS.map((p) => p.chave),
      ['publicitario', 'redator', 'buzz_social', 'analista_de_dados', 'marqueteiro', 'diretor_de_vendas', 'sdr', 'representante_do_cliente', 'risco_legal'],
    );
  });

  it('chaves seguem o padrão do banco e são únicas', () => {
    for (const persona of PERSONAS) assert.match(persona.chave, PADRAO_DA_CHAVE_DA_PERSONA);
    assert.equal(new Set(PERSONAS.map((p) => p.chave)).size, PERSONAS.length);
  });

  it('só risco_legal obriga ajuste quando reprova', () => {
    assert.deepEqual(PERSONAS.filter((p) => p.reprovacaoObrigaAjuste).map((p) => p.chave), ['risco_legal']);
  });

  it('cada persona tem foco, o que olha e instrução curta', () => {
    for (const p of PERSONAS) {
      assert.ok(p.nome.length > 0 && p.foco.length > 0 && p.olha.length > 0);
      assert.ok(p.instrucao.length > 0 && p.instrucao.length <= 300, p.chave);
    }
  });

  it('personaPorChave acha ou devolve undefined', () => {
    assert.equal(personaPorChave('sdr')?.nome, 'SDR');
    assert.equal(personaPorChave('inexistente'), undefined);
  });
});
