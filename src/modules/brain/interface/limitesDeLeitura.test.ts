import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { consumeAll } from '../../../shared/security/rateLimit.ts';
import { LIMITE_DE_LEITURAS_POR_MINUTO, TETO_DE_LEITURAS_POR_MINUTO, limitesDeLeitura, pedidosDeLeitura } from './limitesDeLeitura.ts';

describe('limite de leituras do brain', () => {
  it('o limite é por token e cliente, com teto geral por token', () => {
    const limites = limitesDeLeitura({ BRAIN_LEITURAS_POR_MINUTO: 2, BRAIN_TETO_DE_LEITURAS_POR_MINUTO: 3 });
    const pedir = (cliente: string) => consumeAll(pedidosDeLeitura('fp-teste-limite', cliente, limites), 60_000).allowed;
    assert.equal(pedir('cliente-a'), true);
    assert.equal(pedir('cliente-a'), true);
    assert.equal(pedir('cliente-a'), false, 'cliente A esgotou o próprio limite');
    assert.equal(pedir('cliente-b'), true, 'cliente B não é afetado pelo A');
    assert.equal(pedir('cliente-c'), false, 'o teto geral do token segura a soma');
  });

  it('padrão mais alto que o antigo, configurável, e nunca acima do teto', () => {
    assert.deepEqual(limitesDeLeitura({}), { porCliente: LIMITE_DE_LEITURAS_POR_MINUTO, teto: TETO_DE_LEITURAS_POR_MINUTO });
    assert.ok(LIMITE_DE_LEITURAS_POR_MINUTO > 60);
    assert.deepEqual(limitesDeLeitura({ BRAIN_LEITURAS_POR_MINUTO: 900, BRAIN_TETO_DE_LEITURAS_POR_MINUTO: 500 }), { porCliente: 500, teto: 500 });
  });
});
