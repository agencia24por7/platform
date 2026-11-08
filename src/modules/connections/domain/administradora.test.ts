import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dedupe } from './discovery.ts';

const conta = (externalId: string, managerExternalId: string | null) => ({
  platform: 'google' as const,
  externalId,
  name: `Conta ${externalId}`,
  currency: 'BRL',
  timezone: 'America/Recife',
  managerExternalId,
  spendingLast30Days: null,
  inactive: false,
});

describe('caminho de acesso preferido', () => {
  it('fica com o acesso pela administradora, não com o direto', () => {
    const direto = conta('346-633-6997', '346-633-6997');
    const viaMcc = conta('346-633-6997', '602-780-1803');

    assert.equal(dedupe([direto, viaMcc])[0]?.managerExternalId, '602-780-1803');
  });

  it('a ordem em que a plataforma devolve não decide mais', () => {
    const direto = conta('346-633-6997', '346-633-6997');
    const viaMcc = conta('346-633-6997', '602-780-1803');

    assert.equal(dedupe([viaMcc, direto])[0]?.managerExternalId, '602-780-1803');
    assert.equal(dedupe([direto, viaMcc])[0]?.managerExternalId, '602-780-1803');
  });

  it('mantém o acesso direto quando não há administradora', () => {
    const direto = conta('346-633-6997', '346-633-6997');
    assert.equal(dedupe([direto])[0]?.managerExternalId, '346-633-6997');
  });

  it('trata administradora ausente como acesso direto', () => {
    const semGerente = conta('346-633-6997', null);
    const viaMcc = conta('346-633-6997', '602-780-1803');

    assert.equal(dedupe([semGerente, viaMcc])[0]?.managerExternalId, '602-780-1803');
  });

  it('fica com a primeira administradora quando há mais de uma', () => {
    const porUma = conta('346-633-6997', '602-780-1803');
    const porOutra = conta('346-633-6997', '111-222-3333');

    assert.equal(dedupe([porUma, porOutra])[0]?.managerExternalId, '602-780-1803');
  });

  it('não mistura contas diferentes', () => {
    const resultado = dedupe([
      conta('346-633-6997', '602-780-1803'),
      conta('123-456-7890', '602-780-1803'),
    ]);

    assert.equal(resultado.length, 2);
  });

  it('não mistura plataformas com o mesmo identificador', () => {
    const google = conta('123', null);
    const meta = { ...conta('123', null), platform: 'meta' as const };

    assert.equal(dedupe([google, meta]).length, 2);
  });
});
