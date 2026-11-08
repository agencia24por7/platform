import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canAdminister,
  canOperate,
  displayName,
  isUsableEmail,
  membershipFor,
  normalizeEmail,
} from './user.ts';

describe('e-mail', () => {
  it('normaliza caixa e espaços', () => {
    assert.equal(normalizeEmail('  Bruno@Agencia.COM  '), 'bruno@agencia.com');
  });

  it('aceita endereço comum', () => {
    assert.ok(isUsableEmail('bruno@agencia24por7.com'));
  });

  it('recusa endereço sem domínio pontuado, com espaço ou com dois arrobas', () => {
    assert.equal(isUsableEmail('bruno@localhost'), false);
    assert.equal(isUsableEmail('bru no@x.com'), false);
    assert.equal(isUsableEmail('a@b@c.com'), false);
    assert.equal(isUsableEmail('@agencia.com'), false);
    assert.equal(isUsableEmail('bruno@.com'), false);
  });
});

describe('nome de exibição', () => {
  it('usa o nome do provedor quando existe', () => {
    assert.equal(
      displayName({ email: 'b@x.com', name: 'Bruno Abreu', pictureUrl: null, emailVerified: true }),
      'Bruno Abreu',
    );
  });

  it('cai para a parte local do e-mail quando o nome vem vazio', () => {
    assert.equal(
      displayName({ email: 'Bruno@X.com', name: '   ', pictureUrl: null, emailVerified: true }),
      'bruno',
    );
  });
});

describe('papéis', () => {
  it('dono e administrador administram', () => {
    assert.ok(canAdminister('owner'));
    assert.ok(canAdminister('admin'));
  });

  it('operador opera mas não administra', () => {
    assert.ok(canOperate('operator'));
    assert.equal(canAdminister('operator'), false);
  });

  it('leitor não opera', () => {
    assert.equal(canOperate('viewer'), false);
  });
});

describe('vínculo', () => {
  const vinculos = [
    { organizationId: 'org-1', role: 'owner' as const },
    { organizationId: 'org-2', role: 'viewer' as const },
  ];

  it('encontra o vínculo da organização pedida', () => {
    assert.equal(membershipFor(vinculos, 'org-2')?.role, 'viewer');
  });

  it('devolve nulo para organização sem vínculo', () => {
    assert.equal(membershipFor(vinculos, 'org-alheia'), null);
  });
});
