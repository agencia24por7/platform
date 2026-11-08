import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { triarClientesGoogle } from './discovery.ts';

const linha = (id: string, extra: Record<string, unknown> = {}) => ({
  customerClient: {
    id,
    descriptiveName: `Conta ${id}`,
    currencyCode: 'BRL',
    timeZone: 'America/Recife',
    status: 'ENABLED',
    ...extra,
  },
});

describe('triagem das contas do Google', () => {
  it('separa administradora de conta de anúncio', () => {
    const triagem = triarClientesGoogle(
      { results: [linha('6027801803', { manager: true }), linha('3466336997')] },
      '6027801803',
    );

    assert.equal(triagem.linhas, 2);
    assert.equal(triagem.administradoras, 1);
    assert.equal(triagem.contas.length, 1);
    assert.equal(triagem.contas[0]?.externalId, '346-633-6997');
  });

  it('a conta carrega a administradora que a alcançou', () => {
    const triagem = triarClientesGoogle({ results: [linha('3466336997')] }, '6027801803');
    assert.equal(triagem.contas[0]?.managerExternalId, '602-780-1803');
  });

  it('marca como inativa o que não está habilitado', () => {
    const triagem = triarClientesGoogle(
      { results: [linha('6322560366', { status: 'CANCELED' })] },
      null,
    );

    assert.equal(triagem.contas[0]?.inactive, true);
  });

  it('não confunde resposta recusada com conta nenhuma', () => {
    const recusada = triarClientesGoogle(null, '6027801803');
    const vazia = triarClientesGoogle({ results: [] }, '6027801803');

    assert.deepEqual(recusada, { contas: [], administradoras: 0, linhas: 0 });
    assert.deepEqual(vazia, { contas: [], administradoras: 0, linhas: 0 });
  });

  it('conta todas as linhas, inclusive as que descarta', () => {
    const triagem = triarClientesGoogle(
      {
        results: [
          linha('1', { manager: true }),
          linha('2', { manager: true }),
          linha('3466336997'),
        ],
      },
      null,
    );

    assert.equal(triagem.linhas, 3);
    assert.equal(triagem.administradoras, 2);
    assert.equal(triagem.contas.length, 1);
  });
});
