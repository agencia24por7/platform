import assert from 'node:assert/strict';
import test from 'node:test';
import { conviteVivo, ehPapelConvidavel, expiraEm, validarConvite } from './convite.ts';

const base = { papelDeQuemConvida: 'admin' as const, email: 'alguem@exemplo.com', role: 'operator' };

test('quem opera não convida', () => {
  assert.equal(validarConvite({ ...base, papelDeQuemConvida: 'operator' }), 'sem_permissao');
  assert.equal(validarConvite({ ...base, papelDeQuemConvida: 'viewer' }), 'sem_permissao');
});

test('convite não cria dono', () => {
  assert.equal(validarConvite({ ...base, role: 'owner' }), 'papel_invalido');
  assert.equal(ehPapelConvidavel('owner'), false);
});

test('e-mail precisa ser utilizável', () => {
  assert.equal(validarConvite({ ...base, email: 'sem-arroba' }), 'email_invalido');
  assert.equal(validarConvite(base), null);
});

test('convite expira em sete dias', () => {
  const agora = new Date('2026-01-01T00:00:00Z');
  assert.equal(expiraEm(agora).toISOString(), '2026-01-08T00:00:00.000Z');
});

test('convite aceito, revogado ou vencido não vale mais', () => {
  const agora = new Date('2026-01-05T00:00:00Z');
  const vivo = {
    id: 'i', organizationId: 'o', email: 'a@b.com', role: 'viewer' as const,
    invitedBy: null, expiresAt: new Date('2026-01-08T00:00:00Z'),
    acceptedAt: null, revokedAt: null, createdAt: agora, clientIds: [],
  };
  assert.equal(conviteVivo(vivo, agora), true);
  assert.equal(conviteVivo({ ...vivo, acceptedAt: agora }, agora), false);
  assert.equal(conviteVivo({ ...vivo, revokedAt: agora }, agora), false);
  assert.equal(conviteVivo({ ...vivo, expiresAt: new Date('2026-01-02T00:00:00Z') }, agora), false);
});
