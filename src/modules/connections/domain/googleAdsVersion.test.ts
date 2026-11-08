import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GOOGLE_ADS_SUPPORTED, GOOGLE_ADS_VERSION, isSupportedVersion } from './googleAdsVersion.ts';

describe('versão da API do Google Ads', () => {
  it('a versão em uso está entre as suportadas', () => {
    assert.ok(
      isSupportedVersion(GOOGLE_ADS_VERSION),
      `${GOOGLE_ADS_VERSION} saiu da lista de versões suportadas`,
    );
  });

  it('usa a mais nova da lista, para render o prazo mais longo', () => {
    const maisNova = [...GOOGLE_ADS_SUPPORTED].sort(
      (a, b) => Number(b.slice(1)) - Number(a.slice(1)),
    )[0];

    assert.equal(GOOGLE_ADS_VERSION, maisNova);
  });

  it('recusa versão descontinuada', () => {
    assert.equal(isSupportedVersion('v22'), false);
    assert.equal(isSupportedVersion('v21'), false);
  });

  it('recusa lixo', () => {
    assert.equal(isSupportedVersion(''), false);
    assert.equal(isSupportedVersion('v'), false);
  });
});
