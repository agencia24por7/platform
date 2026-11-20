import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAXIMO_DE_TENTATIVAS_POR_CHAVE, chaveDaTentativa, resolverAbertura } from './tentativaDeColeta.ts';

const banco = (coletas: Record<string, string>) => async (chave: string) =>
  coletas[chave] ? { id: chave, status: coletas[chave]! } : null;

describe('reabrir coleta com a mesma chave de idempotência', () => {
  const chave = 'fonte:2026-11-01:2026-11-19:amostra';

  it('a primeira tentativa usa a chave como veio; as seguintes ganham sufixo dentro de 160 caracteres', () => {
    assert.equal(chaveDaTentativa(chave, 1), chave);
    assert.equal(chaveDaTentativa(chave, 2), `${chave}#2`);
    const longa = chaveDaTentativa('x'.repeat(160), 12);
    assert.equal(longa.length, 160);
    assert.ok(longa.endsWith('#12'));
  });

  it('coleta em running é devolvida (retry em voo)', async () => {
    assert.deepEqual(await resolverAbertura(chave, banco({ [chave]: 'running' })), {
      tipo: 'existente', coleta: { id: chave, status: 'running' },
    });
  });

  it('coleta fechada não é reaproveitada: a rodada seguinte abre outra com a próxima chave livre', async () => {
    assert.deepEqual(await resolverAbertura(chave, banco({ [chave]: 'failed' })), { tipo: 'nova', chave: `${chave}#2` });
    assert.deepEqual(await resolverAbertura(chave, banco({ [chave]: 'success', [`${chave}#2`]: 'partial' })), { tipo: 'nova', chave: `${chave}#3` });
  });

  it('retry da segunda rodada devolve a segunda, ainda em running', async () => {
    const resultado = await resolverAbertura(chave, banco({ [chave]: 'success', [`${chave}#2`]: 'running' }));
    assert.equal(resultado.tipo === 'existente' && resultado.coleta.id, `${chave}#2`);
  });

  it('para depois do teto de tentativas', async () => {
    const todas = Object.fromEntries(
      Array.from({ length: MAXIMO_DE_TENTATIVAS_POR_CHAVE }, (_, i) => [chaveDaTentativa(chave, i + 1), 'failed']),
    );
    assert.deepEqual(await resolverAbertura(chave, banco(todas)), { tipo: 'esgotada' });
  });
});
