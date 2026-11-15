import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { grantTypesFor, missingScopes } from './connection.ts';

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
