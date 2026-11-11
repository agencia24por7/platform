import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { assinaturaDoWhatsappValida, referenciaExternaDoWhatsapp } from './whatsappWebhook.ts';

const SEGREDO = 'segredo-de-teste-com-tamanho-razoavel';

function assinar(corpo: string): string {
  return `sha256=${createHmac('sha256', SEGREDO).update(corpo, 'utf8').digest('hex')}`;
}

test('assinatura correta é aceita', () => {
  const corpo = '{"a":1}';
  assert.ok(assinaturaDoWhatsappValida(corpo, assinar(corpo), SEGREDO));
});

test('assinatura de outro segredo é recusada', () => {
  const corpo = '{"a":1}';
  const assinadaComOutroSegredo = `sha256=${createHmac('sha256', 'outro-segredo-qualquer').update(corpo, 'utf8').digest('hex')}`;
  assert.equal(assinaturaDoWhatsappValida(corpo, assinadaComOutroSegredo, SEGREDO), false);
});

test('corpo alterado depois de assinado é recusado', () => {
  const assinatura = assinar('{"a":1}');
  assert.equal(assinaturaDoWhatsappValida('{"a":2}', assinatura, SEGREDO), false);
});

test('sem header, ou header fora do formato sha256=, é recusado', () => {
  assert.equal(assinaturaDoWhatsappValida('{}', null, SEGREDO), false);
  assert.equal(assinaturaDoWhatsappValida('{}', 'sha1=abc', SEGREDO), false);
});

test('extrai o phone_number_id de dentro de entry.changes.value.metadata', () => {
  const payload = {
    entry: [{ id: 'waba-1', changes: [{ value: { metadata: { phone_number_id: '55512345' } } }] }],
  };
  assert.equal(referenciaExternaDoWhatsapp(payload), '55512345');
});

test('sem metadata, cai para o id da entry', () => {
  const payload = { entry: [{ id: 'waba-1', changes: [{ value: {} }] }] };
  assert.equal(referenciaExternaDoWhatsapp(payload), 'waba-1');
});

test('payload sem entry devolve null', () => {
  assert.equal(referenciaExternaDoWhatsapp({}), null);
  assert.equal(referenciaExternaDoWhatsapp(null), null);
  assert.equal(referenciaExternaDoWhatsapp('texto'), null);
});
