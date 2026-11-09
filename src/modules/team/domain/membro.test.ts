import assert from 'node:assert/strict';
import test from 'node:test';
import { revogacaoPermitida, trocaDePapelPermitida } from './membro.ts';

const alvo = {
  memberId: 'm', userId: 'u2', email: 'a@b.com', name: 'A',
  role: 'operator' as const, revokedAt: null, clientIds: [], createdAt: new Date(),
};

test('quem não administra não mexe na equipe', () => {
  assert.equal(
    revogacaoPermitida({ papelDeQuemAge: 'operator', userIdDeQuemAge: 'u1', alvo, donosVivos: 2 }),
    'sem_permissao',
  );
});

test('ninguém revoga o próprio vínculo', () => {
  assert.equal(
    revogacaoPermitida({ papelDeQuemAge: 'owner', userIdDeQuemAge: 'u2', alvo, donosVivos: 2 }),
    'proprio_vinculo',
  );
});

test('a organização não fica sem responsável', () => {
  const dono = { ...alvo, role: 'owner' as const };
  assert.equal(
    revogacaoPermitida({ papelDeQuemAge: 'owner', userIdDeQuemAge: 'u1', alvo: dono, donosVivos: 1 }),
    'ultimo_dono',
  );
  assert.equal(
    revogacaoPermitida({ papelDeQuemAge: 'owner', userIdDeQuemAge: 'u1', alvo: dono, donosVivos: 2 }),
    null,
  );
});

test('só um dono cria outro dono', () => {
  assert.equal(
    trocaDePapelPermitida({ papelDeQuemAge: 'admin', userIdDeQuemAge: 'u1', alvo, novoPapel: 'owner', donosVivos: 1 }),
    'sem_permissao',
  );
  assert.equal(
    trocaDePapelPermitida({ papelDeQuemAge: 'owner', userIdDeQuemAge: 'u1', alvo, novoPapel: 'owner', donosVivos: 1 }),
    null,
  );
});

test('rebaixar o último dono deixaria a organização órfã', () => {
  const dono = { ...alvo, role: 'owner' as const };
  assert.equal(
    trocaDePapelPermitida({ papelDeQuemAge: 'owner', userIdDeQuemAge: 'u1', alvo: dono, novoPapel: 'admin', donosVivos: 1 }),
    'ultimo_dono',
  );
});

test('quem administra não alcança quem responde pela organização', () => {
  const donoAlvo = { ...alvo, role: 'owner' as const };

  assert.equal(
    revogacaoPermitida({ papelDeQuemAge: 'admin', userIdDeQuemAge: 'u1', alvo: donoAlvo, donosVivos: 3 }),
    'sem_permissao',
  );
  assert.equal(
    trocaDePapelPermitida({
      papelDeQuemAge: 'admin',
      userIdDeQuemAge: 'u1',
      alvo: donoAlvo,
      novoPapel: 'viewer',
      donosVivos: 3,
    }),
    'sem_permissao',
  );
  assert.equal(
    revogacaoPermitida({ papelDeQuemAge: 'owner', userIdDeQuemAge: 'u1', alvo: donoAlvo, donosVivos: 3 }),
    null,
  );
});
