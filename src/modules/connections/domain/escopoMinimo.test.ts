import assert from 'node:assert/strict';
import test from 'node:test';
import { PROVIDERS, authorizeUrlFor, escopoExcedente } from './oauth.ts';

const ADWORDS = 'https://www.googleapis.com/auth/adwords';
const ANALYTICS = 'https://www.googleapis.com/auth/analytics.readonly';

const pedido = (plataforma: 'google' | 'ga4') =>
  new URL(
    authorizeUrlFor(PROVIDERS[plataforma], {
      clientId: 'c',
      redirectUri: 'https://exemplo.test/cb',
      state: 's',
      codeChallenge: 'd',
    }),
  ).searchParams;

test('o Analytics não pede autorização incremental', () => {
  assert.equal(pedido('ga4').get('include_granted_scopes'), null);
  assert.equal(
    pedido('ga4').get('scope'),
    `${ANALYTICS} openid https://www.googleapis.com/auth/userinfo.email`,
  );
});

test('o Google Ads continua somando o que já foi concedido', () => {
  assert.equal(pedido('google').get('include_granted_scopes'), 'true');
});

test('token do Analytics carregando escopo de anúncio é recusado', () => {
  assert.deepEqual(escopoExcedente('ga4', [ANALYTICS]), []);
  assert.deepEqual(escopoExcedente('ga4', [ANALYTICS, ADWORDS]), [ADWORDS]);
  assert.deepEqual(
    escopoExcedente('ga4', [ANALYTICS, 'https://www.googleapis.com/auth/analytics.edit']),
    ['https://www.googleapis.com/auth/analytics.edit'],
  );
});

test('o Google Ads não é barrado por carregar os escopos de identidade', () => {
  assert.deepEqual(escopoExcedente('google', [ADWORDS, 'openid', 'email', 'profile']), []);
});
