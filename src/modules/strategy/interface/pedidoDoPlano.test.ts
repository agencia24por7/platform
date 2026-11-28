import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { intencaoDeTeste } from '../domain/fixturesDeTeste.ts';
import { centavosDeReais } from './formatosDoPlano.ts';
import { lerIntencaoDoFormulario } from './formulariosDaEstrategia.ts';
import { camposDoPedido, intencaoDoPedido, valoresDoPlanoDeOrigem } from './pedidoDoPlano.ts';

const LANDING_PAGE = '00000000-0000-4000-8000-0000000000aa';
const URN = 'orla:88e73b78-f83d-4082-86a9-15bfa0caa367:663192d0-7e8a-42ee-8aa7-2df021eae866:contexto_produto:36c81191-0df2-4899-a713-b9bcd07fe04a';
const PRODUTO = { urn: URN, hash: 'b'.repeat(64), rotulo: 'Consignado CLT' };

describe('pedido do plano', () => {
  it('lê a intenção só da execução de criação, preferindo a ativa', () => {
    const criar = { tipo: 'criar' as const, pedido: intencaoDeTeste() };
    assert.equal(intencaoDoPedido({ execucaoAtiva: null, ultimaExecucao: criar as never })?.objetivo, intencaoDeTeste().objetivo);
    assert.equal(intencaoDoPedido({ execucaoAtiva: null, ultimaExecucao: { tipo: 'ajustar', pedido: { instrucao: 'x' } } as never }), null);
    assert.equal(intencaoDoPedido({ execucaoAtiva: null, ultimaExecucao: { tipo: 'criar', pedido: { objetivo: 'x' } } as never }), null);
    assert.equal(intencaoDoPedido({ execucaoAtiva: null, ultimaExecucao: null }), null);
  });

  it('os campos do pedido voltam ao formulário e são aceitos por ele', () => {
    const campos = camposDoPedido({ tipo: 'aquisicao', landingPageId: LANDING_PAGE, foco: { tipo: 'produtos', produtos: [PRODUTO] } }, intencaoDeTeste());
    assert.equal(campos['landingPageId'], LANDING_PAGE);
    assert.equal(campos['produtos'], URN);
    assert.equal(campos['focoMarca'], undefined);
    assert.equal(campos['plataformas'], 'google,meta');
    assert.equal(centavosDeReais(campos['verba'] ?? ''), '1000000');
    assert.equal(campos['chaveDeIdempotencia'], undefined);
    const lido = lerIntencaoDoFormulario(campos);
    assert.ok(lido.ok, JSON.stringify(lido));
    assert.equal(lido.value.landingPageId, LANDING_PAGE);
  });

  it('plano de origem sem pedido de criação legível deixa o formulário vazio', () => {
    const plano = { tipo: 'aquisicao', landingPageId: LANDING_PAGE, foco: null };
    assert.deepEqual(valoresDoPlanoDeOrigem(null), {});
    assert.deepEqual(valoresDoPlanoDeOrigem({ plano, execucaoAtiva: null, ultimaExecucao: { tipo: 'ajustar', pedido: { instrucao: 'x' } } } as never), {});
    assert.equal(valoresDoPlanoDeOrigem({ plano, execucaoAtiva: null, ultimaExecucao: { tipo: 'criar', pedido: intencaoDeTeste() } } as never)['objetivo'], intencaoDeTeste().objetivo);
  });

  it('plano de marca marca só a campanha de marca; sem landing page no plano usa a do pedido', () => {
    const campos = camposDoPedido({ tipo: 'aquisicao', landingPageId: null, foco: { tipo: 'marca' } }, intencaoDeTeste());
    assert.equal(campos['focoMarca'], '1');
    assert.equal(campos['produtos'], undefined);
    assert.equal(campos['landingPageId'], 'lp_principal');
  });
});
