import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { podeCadastrarCliente } from './permissoes.ts';

describe('quem cadastra cliente ou negócio', () => {
  it('anunciante: só owner e admin', () => {
    assert.equal(podeCadastrarCliente('advertiser', 'owner'), true);
    assert.equal(podeCadastrarCliente('advertiser', 'admin'), true);
    assert.equal(podeCadastrarCliente('advertiser', 'operator'), false);
    assert.equal(podeCadastrarCliente('advertiser', 'viewer'), false);
  });
  it('agência: quem opera', () => {
    assert.equal(podeCadastrarCliente('agency', 'operator'), true);
    assert.equal(podeCadastrarCliente('agency', 'viewer'), false);
  });
});
