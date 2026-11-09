import assert from 'node:assert/strict';
import test from 'node:test';
import { organizacaoAtiva } from './organizacaoAtiva.ts';

const a = { organizationId: 'aaa', role: 'owner' } as const;
const b = { organizationId: 'bbb', role: 'viewer' } as const;

test('sem vínculo não há organização ativa', () => {
  assert.equal(organizacaoAtiva([], 'aaa'), null);
});

test('sem escolha, assume o vínculo mais antigo', () => {
  assert.equal(organizacaoAtiva([a, b], undefined), a);
});

test('respeita a escolha quando ela é um vínculo real', () => {
  assert.equal(organizacaoAtiva([a, b], 'bbb'), b);
});

test('escolha forjada não concede acesso: cai no vínculo real', () => {
  assert.equal(organizacaoAtiva([a, b], 'de-outra-pessoa'), a);
});
