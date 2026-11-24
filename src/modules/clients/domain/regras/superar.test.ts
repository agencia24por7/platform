import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decisao } from './fixturesDeTeste.ts';
import { superar } from './superar.ts';

const operador = { origem: 'agencia', papel: 'operator' } as const;
const admin = { origem: 'agencia', papel: 'admin' } as const;
const codigo = (resultado: ReturnType<typeof superar>) => (resultado.ok ? null : resultado.error.codigo);

describe('superar', () => {
  it('anterior vira superada e a nova aponta para ela', () => {
    const anterior = decisao();
    const nova = decisao({ valor: { unidade: 'brl_centavos', centavos: '2000000', moeda: 'BRL' } });
    const resultado = superar(admin, anterior, nova);
    assert.ok(resultado.ok);
    assert.equal(resultado.value.anterior.status, 'superada');
    assert.equal(resultado.value.nova.supersedesId, anterior.id);
    assert.equal(anterior.status, 'vigente');
  });
  it('anterior precisa estar vigente', () => {
    for (const status of ['proposta', 'superada', 'rejeitada'] as const) {
      assert.equal(codigo(superar(admin, decisao({ status }), decisao())), 'anterior_nao_vigente');
    }
    assert.equal(
      codigo(superar(admin, decisao({ status: 'revogada', motivoDaRevogacao: 'x' }), decisao())),
      'anterior_nao_vigente',
    );
  });
  it('mesma chave, escopo, cliente e natureza', () => {
    assert.equal(codigo(superar(admin, decisao(), decisao({ chave: 'eficiencia.cac_maximo' }))), 'chave_diferente');
    assert.equal(codigo(superar(admin, decisao(), decisao({ escopo: 'plataforma:meta' }))), 'escopo_diferente');
    assert.equal(codigo(superar(admin, decisao(), decisao({ clienteId: 'c2' }))), 'cliente_diferente');
    assert.equal(codigo(superar(admin, decisao(), decisao({ natureza: 'regra' }))), 'natureza_diferente');
    assert.equal(codigo(superar(admin, decisao(), decisao({ chave: null }))), 'sem_chave');
    assert.equal(codigo(superar(admin, decisao(), decisao({ status: 'proposta' }))), 'nova_nao_vigente');
  });
  it('exige permissão: operator não supera limite; agente nunca', () => {
    assert.equal(codigo(superar(operador, decisao(), decisao())), 'sem_permissao');
    assert.equal(codigo(superar({ origem: 'agente' }, decisao(), decisao())), 'sem_permissao');
  });
});
