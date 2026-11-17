import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { concordaComRecurso, grantTypesFor, missingScopes } from './connection.ts';

describe('missingScopes', () => {
  it('exige adwords no Google', () => {
    assert.deepEqual(missingScopes('google', []), ['https://www.googleapis.com/auth/adwords']);
    assert.deepEqual(
      missingScopes('google', ['https://www.googleapis.com/auth/adwords', 'https://www.googleapis.com/auth/datamanager']),
      [],
    );
  });

  it('exige ads_read no Meta', () => {
    assert.deepEqual(missingScopes('meta', ['ads_management']), ['ads_read']);
    assert.deepEqual(missingScopes('meta', ['ads_read']), []);
  });
});

describe('grantTypesFor', () => {
  it('não mistura caminhos entre plataformas', () => {
    assert.ok(!grantTypesFor('google').includes('bm_partner'));
    assert.ok(!grantTypesFor('meta').includes('mcc'));
  });
});

describe('concordaComRecurso', () => {
  it('propriedade do GA4 é feminino; contêiner, site, canal e local são masculinos', () => {
    assert.equal(concordaComRecurso('ga4', 'vinculado', 'vinculada'), 'vinculada');
    for (const platform of ['gtm', 'searchconsole', 'youtube', 'gbp'] as const) {
      assert.equal(concordaComRecurso(platform, 'vinculado', 'vinculada'), 'vinculado');
    }
  });
});
