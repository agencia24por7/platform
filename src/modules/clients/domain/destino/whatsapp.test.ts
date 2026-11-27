import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizarWhatsapp } from './whatsapp.ts';

const valor = (entrada: unknown) => {
  const r = normalizarWhatsapp(entrada);
  return r.ok ? r.value : null;
};

test('celular brasileiro em formatos comuns vira E.164', () => {
  for (const entrada of ['(11) 99999-8888', '11999998888', '011 99999 8888', '+55 11 99999-8888', '5511999998888', '005511999998888', ' +5511999998888 ']) {
    assert.equal(valor(entrada), '+5511999998888', entrada);
  }
});

test('fixo brasileiro com 8 dígitos é aceito', () => {
  assert.equal(valor('(11) 3333-4444'), '+551133334444');
});

test('número internacional válido é preservado', () => {
  assert.equal(valor('+1 415 555 2671'), '+14155552671');
  assert.equal(valor('00351 912 345 678'), '+351912345678');
});

test('rejeita lixo, letras, tamanho e DDD inválidos', () => {
  const ruins: unknown[] = [
    '', '   ', 'abc', '11 9999-ABCD', '+', '++5511999998888', '55+11999998888', '119999988', '1199999888877',
    '(00) 99999-8888', '11 89999-8888', '11 99999999999999999999999999', '+0123456789', '+55119999988', '11 11111111',
    'javascript:alert(1)', '+55 11 99999-8888; DROP TABLE', null, undefined, 5511999998888, {},
  ];
  for (const entrada of ruins) assert.equal(valor(entrada), null, String(entrada));
});

test('falha de validação traz código validation', () => {
  const r = normalizarWhatsapp('abc');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, 'validation');
});
