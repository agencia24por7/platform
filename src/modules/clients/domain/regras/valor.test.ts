import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compararDecimais,
  compararValores,
  formatarValor,
  valorDecimal,
  valorEmCentavos,
  valoresIguais,
  ValorSchema,
} from './valor.ts';

function valorOuFalha<T>(resultado: { ok: true; value: T } | { ok: false }): T {
  if (!resultado.ok) throw new Error('esperava ok');
  return resultado.value;
}

describe('valor', () => {
  it('centavos aceitam inteiro seguro e texto, e recusam fração, negativo e inseguro', () => {
    assert.ok(valorEmCentavos(12345).ok);
    assert.ok(valorEmCentavos('999999999999999').ok);
    assert.ok(valorEmCentavos(12345n).ok);
    assert.ok(!valorEmCentavos(1.5).ok);
    assert.ok(!valorEmCentavos(-1).ok);
    assert.ok(!valorEmCentavos(Number.MAX_SAFE_INTEGER + 1).ok);
    assert.ok(!valorEmCentavos('12,5').ok);
  });
  it('decimal exato: 0.1 + 0.2 não é problema porque nada é somado em float', () => {
    assert.equal(compararDecimais('0.3', '0.30'), 0);
    assert.equal(compararDecimais('0.1', '0.10000001'), -1);
    assert.equal(compararDecimais('12345678901234567.99999999', '12345678901234567.99999998'), 1);
  });
  it('compara valores da mesma unidade e recusa unidades diferentes', () => {
    const a = valorOuFalha(valorEmCentavos(100));
    const b = valorOuFalha(valorEmCentavos('101'));
    assert.deepEqual(compararValores(a, b), { ok: true, value: -1 });
    assert.ok(valoresIguais(a, valorOuFalha(valorEmCentavos('100'))));
    const razao = valorOuFalha(valorDecimal('razao', '3.5'));
    const resultado = compararValores(a, razao);
    assert.ok(!resultado.ok && resultado.error.codigo === 'unidades_diferentes');
    assert.ok(!valoresIguais(a, razao));
  });
  it('formata sem ponto flutuante', () => {
    assert.equal(formatarValor(valorOuFalha(valorEmCentavos(5))), 'R$ 0,05');
    assert.equal(formatarValor(valorOuFalha(valorEmCentavos('123456789'))), 'R$ 1.234.567,89');
    assert.equal(formatarValor(valorOuFalha(valorDecimal('percentual', '12.5'))), '12,5%');
    assert.equal(formatarValor(valorOuFalha(valorDecimal('razao', '3.25'))), '3,25x');
  });
  it('schema recusa decimal com vírgula, sinal, campo extra e moeda diferente', () => {
    assert.ok(!valorDecimal('razao', '3,5').ok);
    assert.ok(!valorDecimal('percentual', '-1').ok);
    assert.ok(!ValorSchema.safeParse({ unidade: 'razao', decimal: '1', extra: 1 }).success);
    assert.ok(!ValorSchema.safeParse({ unidade: 'brl_centavos', centavos: '1', moeda: 'USD' }).success);
    assert.ok(!ValorSchema.safeParse({ unidade: 'brl_centavos', centavos: 10, moeda: 'BRL' }).success);
    assert.ok(ValorSchema.safeParse({ unidade: 'brl_centavos', centavos: '10', moeda: 'BRL' }).success);
  });
});
