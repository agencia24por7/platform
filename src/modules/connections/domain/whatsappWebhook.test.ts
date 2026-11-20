import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { assinaturaDaMetaValida, referenciaExternaDoWhatsapp, resumirAvisoDoWhatsapp } from './whatsappWebhook.ts';

const SEGREDO = 'segredo-de-teste-com-tamanho-razoavel';

function assinar(corpo: string): string {
  return `sha256=${createHmac('sha256', SEGREDO).update(corpo, 'utf8').digest('hex')}`;
}

test('assinatura correta é aceita', () => {
  const corpo = '{"a":1}';
  assert.ok(assinaturaDaMetaValida(corpo, assinar(corpo), SEGREDO));
});

test('assinatura de outro segredo é recusada', () => {
  const corpo = '{"a":1}';
  const assinadaComOutroSegredo = `sha256=${createHmac('sha256', 'outro-segredo-qualquer').update(corpo, 'utf8').digest('hex')}`;
  assert.equal(assinaturaDaMetaValida(corpo, assinadaComOutroSegredo, SEGREDO), false);
});

test('corpo alterado depois de assinado é recusado', () => {
  const assinatura = assinar('{"a":1}');
  assert.equal(assinaturaDaMetaValida('{"a":2}', assinatura, SEGREDO), false);
});

test('sem header, ou header fora do formato sha256=, é recusado', () => {
  assert.equal(assinaturaDaMetaValida('{}', null, SEGREDO), false);
  assert.equal(assinaturaDaMetaValida('{}', 'sha1=abc', SEGREDO), false);
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

test('o aviso da Cloud API guarda a atribuição ao anúncio, sem texto, nome nem telefone', () => {
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: 'Maria da Silva' }, wa_id: '5581999990000' }],
      messages: [{
        id: 'wamid.1', timestamp: '1763600000', type: 'text', from: '5581999990000',
        text: { body: 'quero o empréstimo' },
        referral: { ctwa_clid: 'clid-1', source_id: '1200', source_type: 'ad', source_url: 'https://fb.me/x' },
      }],
    } }] }],
  };
  const resumo = resumirAvisoDoWhatsapp(payload, 'chave');
  const serializado = JSON.stringify(resumo);

  assert.ok(!serializado.includes('Maria'));
  assert.ok(!serializado.includes('empréstimo'));
  assert.ok(!serializado.includes('5581999990000'));
  assert.match(serializado, /clid-1/);
  assert.match(serializado, /wamid\.1/);
});

test('o aviso da Z-API vira o mesmo resumo, e o pseudônimo do contato é estável', () => {
  const um = resumirAvisoDoWhatsapp({ phone: '5581999990000', messageId: 'm1', senderName: 'Maria', text: { message: 'oi' } }, 'chave');
  const outro = resumirAvisoDoWhatsapp({ phone: '+55 81 99999-0000', messageId: 'm2' }, 'chave');
  const contato = (r: Record<string, unknown>) => (r['mensagens'] as { contato: string }[])[0]!.contato;

  assert.ok(!JSON.stringify(um).includes('Maria'));
  assert.equal(contato(um), contato(outro));
  assert.notEqual(contato(um), contato(resumirAvisoDoWhatsapp({ phone: '5581999990000' }, 'outra-chave')));
});
