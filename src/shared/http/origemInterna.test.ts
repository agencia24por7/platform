import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enderecoPrivado, veioDeFora } from './origemInterna.ts';

const cabecalhos = (valores: Record<string, string>) => new Headers(valores);

describe('rotas do cofre só pela rede interna (ADR 0032)', () => {
  it('chamada direta do n8n (app:3000) passa: o Next só preenche o endereço privado do socket e http', () => {
    assert.equal(veioDeFora(cabecalhos({ 'x-forwarded-for': '172.18.0.5', 'x-forwarded-proto': 'http' })), false);
    assert.equal(veioDeFora(cabecalhos({ 'x-forwarded-for': '::ffff:10.1.2.3' })), false);
    assert.equal(veioDeFora(cabecalhos({ 'x-forwarded-for': '::1' })), false);
    assert.equal(veioDeFora(cabecalhos({})), false);
  });

  it('o que passou pelo proxy público é recusado', () => {
    assert.equal(veioDeFora(cabecalhos({ 'x-forwarded-for': '203.0.113.9' })), true);
    assert.equal(veioDeFora(cabecalhos({ 'x-forwarded-for': '10.0.0.2, 203.0.113.9' })), true);
    assert.equal(veioDeFora(cabecalhos({ 'x-forwarded-for': '' })), true);
    assert.equal(veioDeFora(cabecalhos({ 'x-forwarded-for': '172.18.0.5', 'x-forwarded-proto': 'https' })), true);
    assert.equal(veioDeFora(cabecalhos({ forwarded: 'for=10.0.0.1' })), true);
    assert.equal(veioDeFora(cabecalhos({ 'x-real-ip': '10.0.0.1' })), true);
  });

  it('faixas privadas', () => {
    for (const ip of ['10.0.0.1', '192.168.1.1', '172.16.0.1', '172.31.255.255', 'fd00::1', 'fe80::1']) assert.equal(enderecoPrivado(ip), true, ip);
    for (const ip of ['172.32.0.1', '8.8.8.8', '2001:db8::1', '']) assert.equal(enderecoPrivado(ip), false, ip);
  });
});
