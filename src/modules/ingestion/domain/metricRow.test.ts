import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCoherent } from './metricRow.ts';

const base = {
  externalCampaignId: 'c1',
  campaignName: 'Teste',
  metricDate: '2026-11-01',
  spend: 100,
  impressions: 1000,
  clicks: 20,
  conversions: 2,
  revenue: 400,
  currency: 'BRL',
};

describe('isCoherent', () => {
  it('aceita linha coerente', () => {
    assert.ok(isCoherent(base));
  });

  it('recusa mais cliques que impressões', () => {
    assert.ok(!isCoherent({ ...base, clicks: 1001 }));
  });

  it('recusa gasto sem impressão', () => {
    assert.ok(!isCoherent({ ...base, impressions: 0, clicks: 0 }));
  });

  it('aceita dia zerado', () => {
    assert.ok(isCoherent({ ...base, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 }));
  });
});
