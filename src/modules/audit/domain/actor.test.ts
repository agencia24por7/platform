import assert from 'node:assert/strict';
import test from 'node:test';
import { enderecoConfiavel, enderecoDoPedido, provaDoProxyValida } from './actor.ts';

test('o endereço confiável é o salto do nosso proxy, não o que o cliente alegou', () => {
  assert.equal(enderecoConfiavel('1.2.3.4, 10.0.0.9, 203.0.113.7'), '203.0.113.7');
  assert.equal(enderecoConfiavel('invasor-forjou-isto, 203.0.113.7'), '203.0.113.7');
  assert.equal(enderecoConfiavel(null), null);
  assert.equal(enderecoConfiavel('lixo!!!'), null);
});

test('aceita endereço único, sem vírgula nenhuma', () => {
  assert.equal(enderecoConfiavel('189.89.237.149'), '189.89.237.149');
});

test('tira a porta de um endereço ipv4', () => {
  assert.equal(enderecoConfiavel('10.0.0.9, 189.89.237.149:51324'), '189.89.237.149');
});

test('preserva ipv6, que tem dois-pontos de verdade', () => {
  assert.equal(enderecoConfiavel('10.0.0.9, 2001:db8::1'), '2001:db8::1');
});

test('recusa ausência e lixo em vez de gravar sujeira na auditoria', () => {
  assert.equal(enderecoConfiavel(''), null);
  assert.equal(enderecoConfiavel('   '), null);
  assert.equal(enderecoConfiavel('<script>'), null);
});

test('recusa valor absurdamente longo', () => {
  assert.equal(enderecoConfiavel('9'.repeat(60)), null);
});

const SEGREDO = 'a'.repeat(64);
const cabecalhos = (valores: Record<string, string>) => ({ get: (nome: string) => valores[nome.toLowerCase()] ?? null });

test('com segredo configurado, só confia no x-forwarded-for quando a prova do proxy confere', () => {
  const confianca = { segredo: SEGREDO, producao: true };
  assert.equal(enderecoDoPedido(cabecalhos({ 'x-forwarded-for': '1.2.3.4', 'x-orla-borda': SEGREDO }), confianca), '1.2.3.4');
  assert.equal(enderecoDoPedido(cabecalhos({ 'x-forwarded-for': '1.2.3.4' }), confianca), null);
  assert.equal(enderecoDoPedido(cabecalhos({ 'x-forwarded-for': '1.2.3.4', 'x-orla-borda': 'b'.repeat(64) }), confianca), null);
  assert.equal(enderecoDoPedido(cabecalhos({ 'x-forwarded-for': '1.2.3.4', 'x-orla-borda': '' }), confianca), null);
  assert.equal(enderecoDoPedido(cabecalhos({ 'x-orla-borda': SEGREDO }), confianca), null);
});

test('chamador interno que inventa x-forwarded-for sem a prova cai sempre no mesmo valor desconhecido', () => {
  const confianca = { segredo: SEGREDO, producao: true };
  const enderecos = new Set<string | null>();
  for (let i = 0; i < 50; i += 1) enderecos.add(enderecoDoPedido(cabecalhos({ 'x-forwarded-for': `9.9.9.${i}` }), confianca));
  assert.deepEqual([...enderecos], [null]);
});

test('em produção sem segredo o endereço é desconhecido; fora de produção mantém o comportamento antigo', () => {
  const pedido = cabecalhos({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' });
  assert.equal(enderecoDoPedido(pedido, { segredo: undefined, producao: true }), null);
  assert.equal(enderecoDoPedido(pedido, { segredo: undefined, producao: false }), '203.0.113.7');
});

test('a prova compara valores de tamanhos diferentes sem lançar', () => {
  assert.equal(provaDoProxyValida('curto', SEGREDO), false);
  assert.equal(provaDoProxyValida(SEGREDO + 'x', SEGREDO), false);
  assert.equal(provaDoProxyValida(SEGREDO, SEGREDO), true);
  assert.equal(provaDoProxyValida(null, SEGREDO), false);
});
