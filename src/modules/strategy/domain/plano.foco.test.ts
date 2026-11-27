import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashDeTeste, intencaoDeTeste, planoMinimoBruto, urnDeTeste } from './fixturesDeTeste.ts';
import { esquemaIntencao, esquemaFoco, lerPlano, urnsDoFoco, MAXIMO_DE_PRODUTOS_NO_FOCO } from './plano.ts';

const produto = (n: number) => ({ urn: urnDeTeste('contexto_produto', `p${n}`), rotulo: `Produto ${n}`, hash: hashDeTeste(n + 20) });

describe('foco do plano no esquema da intenção', () => {
  it('aceita marca e de 1 a 20 produtos distintos', () => {
    assert.ok(esquemaFoco.safeParse({ tipo: 'marca' }).success);
    assert.ok(esquemaFoco.safeParse({ tipo: 'produtos', produtos: [produto(1)] }).success);
    assert.ok(esquemaFoco.safeParse({ tipo: 'produtos', produtos: Array.from({ length: MAXIMO_DE_PRODUTOS_NO_FOCO }, (_, i) => produto(i)) }).success);
  });

  it('recusa lista vazia, acima de 20, duplicata, hash ruim, campo extra e misturar marca com produtos', () => {
    assert.equal(esquemaFoco.safeParse({ tipo: 'produtos', produtos: [] }).success, false);
    assert.equal(esquemaFoco.safeParse({ tipo: 'produtos', produtos: Array.from({ length: 21 }, (_, i) => produto(i)) }).success, false);
    assert.equal(esquemaFoco.safeParse({ tipo: 'produtos', produtos: [produto(1), produto(1)] }).success, false);
    assert.equal(esquemaFoco.safeParse({ tipo: 'produtos', produtos: [{ ...produto(1), hash: 'xyz' }] }).success, false);
    assert.equal(esquemaFoco.safeParse({ tipo: 'produtos', produtos: [{ ...produto(1), extra: 1 }] }).success, false);
    assert.equal(esquemaFoco.safeParse({ tipo: 'marca', produtos: [produto(1)] }).success, false);
    assert.equal(esquemaFoco.safeParse({ tipo: 'produtos', produtos: [{ ...produto(1), urn: 'texto' }] }).success, false);
  });

  it('o campo foco é opcional para o plano antigo e entra na intenção fixa', () => {
    assert.ok(esquemaIntencao.safeParse(intencaoDeTeste()).success);
    const comFoco = esquemaIntencao.parse({ ...intencaoDeTeste(), foco: { tipo: 'produtos', produtos: [produto(1)] } });
    assert.deepEqual(urnsDoFoco(comFoco.foco), [produto(1).urn]);
    assert.deepEqual(urnsDoFoco(undefined), []);
  });

  it('plano com foco, campanha com produto e verba por produto é lido; sem eles continua lido', () => {
    const bruto = planoMinimoBruto() as unknown as Record<string, unknown> & { intencao: Record<string, unknown>; campanhas: { campanhas: Record<string, unknown>[] }; orcamento: Record<string, unknown> };
    assert.ok(lerPlano(bruto).ok);
    bruto.intencao.foco = { tipo: 'produtos', produtos: [produto(1)] };
    bruto.campanhas.campanhas[0]!.produto = produto(1).urn;
    bruto.orcamento.por_produto = [{ produto: produto(1).urn, valor: { centavos: '1000000', moeda: 'BRL' }, evidencias: [] }];
    assert.ok(lerPlano(bruto).ok);
    bruto.campanhas.campanhas[0]!.produto = 'texto livre';
    assert.equal(lerPlano(bruto).ok, false);
  });
});
