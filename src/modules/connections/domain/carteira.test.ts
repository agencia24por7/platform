import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agruparPorAdministradora, type ContaAlcancavel } from './carteira.ts';

const conta = (
  externalId: string,
  managerExternalId: string | null,
  state: ContaAlcancavel['state'] = 'discovered',
  inactive = false,
): ContaAlcancavel => ({
  id: `id-${externalId}`,
  platform: 'google',
  externalId,
  name: `Conta ${externalId}`,
  currency: 'BRL',
  timezone: 'America/Recife',
  managerExternalId,
  spendingLast30Days: null,
  inactive,
  state,
});

describe('carteira por caminho de acesso', () => {
  it('agrupa as contas sob a administradora que as alcança', () => {
    const caminhos = agruparPorAdministradora([
      conta('111-111-1111', '602-780-1803'),
      conta('222-222-2222', '602-780-1803'),
    ]);

    assert.equal(caminhos.length, 1);
    assert.equal(caminhos[0]?.administradora, '602-780-1803');
    assert.equal(caminhos[0]?.contas.length, 2);
  });

  it('trata conta que aponta para si mesma como acesso direto', () => {
    const caminhos = agruparPorAdministradora([conta('346-633-6997', '346-633-6997')]);
    assert.equal(caminhos[0]?.administradora, null);
  });

  it('separa administradoras diferentes', () => {
    const caminhos = agruparPorAdministradora([
      conta('111-111-1111', '602-780-1803'),
      conta('222-222-2222', '999-999-9999'),
    ]);

    assert.equal(caminhos.length, 2);
  });

  it('põe o acesso direto por último, porque a agência opera pela MCC', () => {
    const caminhos = agruparPorAdministradora([
      conta('346-633-6997', null),
      conta('111-111-1111', '602-780-1803'),
    ]);

    assert.equal(caminhos[0]?.administradora, '602-780-1803');
    assert.equal(caminhos[1]?.administradora, null);
  });

  it('conta vinculadas e disponíveis separadamente', () => {
    const caminhos = agruparPorAdministradora([
      conta('111-111-1111', '602-780-1803', 'linked'),
      conta('222-222-2222', '602-780-1803', 'discovered'),
      conta('333-333-3333', '602-780-1803', 'discovered', true),
      conta('444-444-4444', '602-780-1803', 'ignored'),
    ]);

    assert.equal(caminhos[0]?.vinculadas, 1);
    assert.equal(caminhos[0]?.disponiveis, 1);
  });

  it('não inventa caminho quando não há conta', () => {
    assert.deepEqual(agruparPorAdministradora([]), []);
  });
});
