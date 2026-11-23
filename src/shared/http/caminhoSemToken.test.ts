import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mascararTokensEmTexto } from './caminhoSemToken.ts';

const TOKEN = 'ABCDEFGH12345';

describe('mascararTokensEmTexto', () => {
  const casos: Record<string, string> = {
    'message do relato': `falhou em /contexto/${TOKEN}?x=1`,
    'stack do relato': `at fetch (/api/contexto/publico/${TOKEN}/arquivos)`,
    'url absoluta com host': `https://app.orla.com.br/contexto/${TOKEN}`,
    'convite': `GET /convite/${TOKEN} 500`,
    'api convite': `/api/convite/${TOKEN}`,
    'webhook': `/api/webhooks/zapi/${TOKEN}`,
    'portaria': `/api/portaria/receber?t=${TOKEN}&de=/`,
    'query t': `https://x.com/p?a=1&t=${TOKEN}#h`,
    'query token': `/p?token=${TOKEN}`,
    'hash': `https://x.com/contexto/${TOKEN}#secao`,
    'maiúsculas': `HTTPS://X.COM/CONTEXTO/${TOKEN}`,
    'maiúsculas na query': `/p?T=${TOKEN}`,
    'barra dupla': `//contexto//${TOKEN}`,
    'barra codificada': `/contexto%2F${TOKEN}`,
    'barra codificada em minúsculas': `%2fcontexto%2f${TOKEN}`,
    'ponto e vírgula': `/contexto;x=1/${TOKEN}`,
    'ponto e vírgula depois do token': `/convite/${TOKEN};jsessionid=1`,
    'entre aspas': `"/contexto/${TOKEN}"`,
    'query codificada': `/p%3Ft%3D${TOKEN}`,
    'barra escapada de JSON': `{"url":"\\/convite\\/${TOKEN}"}`,
    'barra unicode escapada': `\\u002fcontexto\\u002f${TOKEN}`,
    'dupla codificação': `/contexto%252F${TOKEN}`,
    'palavra-chave percent-encoded': `/%63ontexto/${TOKEN}`,
    'palavra-chave percent-encoded maiúscula': `/%43ONTEXTO/${TOKEN}`,
    'token entre colchetes': `/contexto/[${TOKEN}]`,
    'token entre colchetes codificados': `/convite/%5B${TOKEN}%5D`,
    'oauth code': `/api/oauth/callback?code=${TOKEN}&x=1`,
    'oauth state': `/api/oauth/callback?x=1&state=${TOKEN}`,
    'exclusão de dados': `/exclusao-de-dados/status/${TOKEN}`,
  };

  for (const [nome, texto] of Object.entries(casos)) {
    it(`não deixa o token cru: ${nome}`, () => {
      const saida = mascararTokensEmTexto(texto);
      assert.ok(!saida.includes(TOKEN), saida);
      assert.ok(saida.includes('[token]'), saida);
    });
  }

  it('code do OAuth do Google com barra e percent', () => {
    const CODIGO = '4/0AbCdEfGhIjKlMnOp-qRsT';
    for (const texto of [`/cb?code=${CODIGO}&scope=x`, `/cb?code=${encodeURIComponent(CODIGO)}&scope=x`, `/cb%3Fcode%3D${encodeURIComponent(CODIGO)}`]) {
      const saida = mascararTokensEmTexto(texto);
      assert.ok(!saida.includes('0AbCdEf') && !saida.includes('qRsT'), saida);
      assert.ok(saida.includes('[token]'), saida);
    }
  });

  it('não mascara diagnóstico legítimo (falsos positivos)', () => {
    for (const texto of [
      '/clientes/123/contexto/editar',
      '/clientes/abc-1/contexto/brain',
      'erro em /contexto/publico',
      'erro em /contexto/publico.',
      `/api/contexto/${TOKEN}/arquivos`,
      '/clientes/123/convite/novo',
    ]) {
      assert.equal(mascararTokensEmTexto(texto), texto);
    }
  });

  it('um passo só: não gera marcas duplicadas', () => {
    assert.equal(mascararTokensEmTexto(`/api/contexto/publico/${TOKEN}/arquivos`), '/api/contexto/publico/[token]/arquivos');
    assert.equal(mascararTokensEmTexto('/contexto/[token]'), '/contexto/[token]');
  });

  it('preserva o resto do texto', () => {
    assert.equal(mascararTokensEmTexto(`falhou em /contexto/${TOKEN}?x=1`), 'falhou em /contexto/[token]?x=1');
    assert.equal(mascararTokensEmTexto(`/api/contexto/publico/${TOKEN}/arquivos`), '/api/contexto/publico/[token]/arquivos');
  });

  it('mascara várias ocorrências', () => {
    const saida = mascararTokensEmTexto(`/contexto/${TOKEN} e /convite/${TOKEN}Z`);
    assert.ok(!saida.includes(TOKEN));
  });

  it('não mexe em texto sem token', () => {
    assert.equal(mascararTokensEmTexto('TypeError: x is undefined at /clientes/abc'), 'TypeError: x is undefined at /clientes/abc');
    assert.equal(mascararTokensEmTexto('access_token=abc'), 'access_token=abc');
  });

  it('termina rápido com entrada patológica', () => {
    const inicio = process.hrtime.bigint();
    mascararTokensEmTexto('/contexto/'.repeat(30_000));
    mascararTokensEmTexto('/'.repeat(300_000));
    assert.ok(Number(process.hrtime.bigint() - inicio) / 1_000_000 < 500);
  });
});
