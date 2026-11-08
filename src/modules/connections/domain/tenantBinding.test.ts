import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideBinding, decodeStateCookie, encodeStateCookie } from './tenantBinding.ts';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';

describe('cookie de estado', () => {
  it('ida e volta preserva os três campos', () => {
    const binding = { state: 'google.abc', returnTo: '/comecar?passo=contas', organizationId: 'org-1' };
    assert.deepEqual(decodeStateCookie(encodeStateCookie(binding, SEGREDO), SEGREDO), binding);
  });

  it('trata ausência de organização no primeiro acesso', () => {
    const decoded = decodeStateCookie(encodeStateCookie({ state: 's', returnTo: '/x', organizationId: null }, SEGREDO), SEGREDO);
    assert.equal(decoded?.organizationId, null);
  });

  it('recusa cookie vazio ou sem estado', () => {
    assert.equal(decodeStateCookie('', SEGREDO), null);
    assert.equal(decodeStateCookie('|/x|org-1', SEGREDO), null);
  });

  it('recusa cookie adulterado', () => {
    const valido = encodeStateCookie({ state: 's', returnTo: '/x', organizationId: 'org-1' }, SEGREDO);
    const corpo = Buffer.from('s|/x|org-invasora').toString('base64url');
    const forjado = `${corpo}.${valido.slice(valido.lastIndexOf('.') + 1)}`;
    assert.equal(decodeStateCookie(forjado, SEGREDO), null);
  });

  it('recusa assinatura de outro segredo', () => {
    const outro = encodeStateCookie({ state: 's', returnTo: '/x', organizationId: 'org-1' }, 'outro-segredo-bem-longo-aqui');
    assert.equal(decodeStateCookie(outro, SEGREDO), null);
  });
});

describe('decideBinding', () => {
  it('usa a organização amarrada no início', () => {
    assert.deepEqual(decideBinding('org-1', 3), { kind: 'use', organizationId: 'org-1' });
  });

  it('cria no primeiro acesso, quando não há nenhuma', () => {
    assert.deepEqual(decideBinding(null, 0), { kind: 'create' });
  });

  it('recusa quando não há binding e já existem organizações', () => {
    assert.deepEqual(decideBinding(null, 1), { kind: 'refuse', reason: 'ambiguo' });
    assert.deepEqual(decideBinding(null, 9), { kind: 'refuse', reason: 'ambiguo' });
  });
});
