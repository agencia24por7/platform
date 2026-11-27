import assert from 'node:assert/strict';
import test from 'node:test';
import { TAMANHO_MAXIMO_DA_URL, validarUrlDeDestino } from './urlDeDestino.ts';

const valor = (entrada: unknown) => {
  const r = validarUrlDeDestino(entrada);
  return r.ok ? r.value : null;
};

test('normaliza: minúsculas no host, sem fragmento, sem espaços nas pontas', () => {
  assert.equal(valor('  https://Loja.Exemplo.com.br/promo?utm=1#topo '), 'https://loja.exemplo.com.br/promo?utm=1');
  assert.equal(valor('https://exemplo.com'), 'https://exemplo.com/');
  assert.equal(valor('HTTPS://exemplo.com:443/a'), 'https://exemplo.com/a');
});

test('aceita domínio internacionalizado em punycode', () => {
  assert.equal(valor('https://café.com.br/'), 'https://xn--caf-dma.com.br/');
});

test('só https', () => {
  for (const entrada of ['http://exemplo.com', 'ftp://exemplo.com', 'javascript:alert(1)', 'exemplo.com', '//exemplo.com', 'data:text/html,x']) {
    assert.equal(valor(entrada), null, entrada);
  }
});

test('recusa credencial embutida e porta explícita', () => {
  assert.equal(valor('https://user:senha@exemplo.com/'), null);
  assert.equal(valor('https://user@exemplo.com/'), null);
  assert.equal(valor('https://exemplo.com:8443/'), null);
});

test('recusa IP em qualquer forma, localhost e host interno', () => {
  const ruins = [
    'https://127.0.0.1/', 'https://10.0.0.5/x', 'https://169.254.169.254/latest', 'https://2130706433/', 'https://0x7f.1/',
    'https://[::1]/', 'https://[2001:db8::1]/', 'https://localhost/', 'https://app.localhost/', 'https://servidor/', 'https://nas.local/',
    'https://api.internal/', 'https://exemplo.invalid/', 'https://exemplo.test/', 'https://exemplo/', 'https://a..com/', 'https://exemplo.123/',
  ];
  for (const entrada of ruins) assert.equal(valor(entrada), null, entrada);
});

test('recusa espaço, controle, tamanho e tipos errados', () => {
  assert.equal(valor('https://exemplo.com/a b'), null);
  assert.equal(valor('https://exemplo.com/\u0000'), null);
  assert.equal(valor(`https://exemplo.com/${'a'.repeat(TAMANHO_MAXIMO_DA_URL)}`), null);
  for (const entrada of ['', '   ', null, undefined, 1, {}]) assert.equal(valor(entrada), null);
});
