import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { caminhoDaOrigem, textoDoCliente } from './relatoDoCliente.ts';

const TOKEN = 'ABCDEFGH12345';

describe('relato de erro do cliente', () => {
  it('message e stack do relato saem sem o token', () => {
    const message = textoDoCliente(`falhou em /contexto/${TOKEN}?x=1`, 2000);
    const stack = textoDoCliente(`at x (/api/contexto/publico/${TOKEN}/arquivos)`);
    assert.equal(message, 'falhou em /contexto/[token]?x=1');
    assert.equal(stack, 'at x (/api/contexto/publico/[token]/arquivos)');
  });

  it('digest com token e e-mail sai limpo', () => {
    const saida = textoDoCliente(`/convite/${TOKEN} joao.silva@empresa.com.br`, 200) ?? '';
    assert.ok(!saida.includes(TOKEN) && !saida.includes('joao.silva'));
  });

  it('ignora vazio e não string', () => {
    assert.equal(textoDoCliente('', 10), null);
    assert.equal(textoDoCliente(42, 10), null);
  });

  it('aplica o limite depois de redigir', () => {
    assert.equal(textoDoCliente('a'.repeat(50), 10)?.length, 10);
  });

  it('caminho da origem da rota pública de arquivos tem uma marca só', () => {
    assert.equal(caminhoDaOrigem(`https://app.x.com/api/contexto/publico/${TOKEN}/arquivos`), '/api/contexto/publico/[token]/arquivos');
  });

  it('caminho da origem sem token, inclusive codificado', () => {
    assert.equal(caminhoDaOrigem(`https://app.x.com/contexto/${TOKEN}?q=1#h`), '/contexto/[token]');
    assert.ok(!(caminhoDaOrigem(`https://app.x.com/contexto%2F${TOKEN}`) ?? '').includes(TOKEN));
    assert.equal(caminhoDaOrigem(null), null);
    assert.equal(caminhoDaOrigem('nao é url'), null);
  });
});
