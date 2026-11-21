import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { destinoComAviso } from './destinoComAviso.ts';

describe('destino com aviso', () => {
  it('acrescenta o aviso a um caminho sem query', () => {
    assert.equal(destinoComAviso('/integracoes', 'ok'), '/integracoes?aviso=ok');
  });

  it('acrescenta com & quando o caminho já tem query', () => {
    assert.equal(
      destinoComAviso('/integracoes/conector/meta?autorizado=meta', 'ok'),
      '/integracoes/conector/meta?autorizado=meta&aviso=ok',
    );
  });

  it('troca um aviso antigo em vez de duplicar', () => {
    assert.equal(destinoComAviso('/integracoes?aviso=velho&x=1', 'novo'), '/integracoes?aviso=novo&x=1');
  });

  it('mantém o fragmento depois da query', () => {
    assert.equal(destinoComAviso('/integracoes#google', 'ok'), '/integracoes?aviso=ok#google');
    assert.equal(destinoComAviso('/integracoes?a=1#google', 'ok'), '/integracoes?a=1&aviso=ok#google');
  });

  it('codifica caracteres especiais do aviso', () => {
    const destino = destinoComAviso('/integracoes', 'Chave & token = 100%? "sim"');
    assert.equal(new URL(destino, 'https://x.invalid').searchParams.get('aviso'), 'Chave & token = 100%? "sim"');
    assert.ok(!destino.includes(' '));
    assert.equal(destino.split('?').length, 2);
  });

  it('recusa destino externo ou fora do padrão e cai em /integracoes', () => {
    assert.equal(destinoComAviso('https://evil.example/x', 'ok'), '/integracoes?aviso=ok');
    assert.equal(destinoComAviso('//evil.example/x', 'ok'), '/integracoes?aviso=ok');
    assert.equal(destinoComAviso('/\\evil.example', 'ok'), '/integracoes?aviso=ok');
    assert.equal(destinoComAviso('', 'ok'), '/integracoes?aviso=ok');
  });
});
