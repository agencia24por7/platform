import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactText } from './redact.ts';

describe('redação de texto cru', () => {
  it('esconde token dentro de json de erro', () => {
    const corpo = '{"error":"invalid","access_token":"ya29.a0AfH6SMB-segredo"}';
    const limpo = redactText(corpo);

    assert.ok(!limpo.includes('ya29.a0AfH6SMB-segredo'));
    assert.match(limpo, /"access_token": "\[redigido\]"/);
    assert.match(limpo, /invalid/, 'a mensagem util precisa sobreviver');
  });

  it('esconde refresh token e segredo de cliente', () => {
    const corpo = '{"refresh_token":"1//04abcdefghij","client_secret":"GOCSPX-abcdefghij"}';
    const limpo = redactText(corpo);

    assert.ok(!limpo.includes('1//04abcdefghij'));
    assert.ok(!limpo.includes('GOCSPX-abcdefghij'));
  });

  it('esconde token solto, fora de json', () => {
    const limpo = redactText('falhou com ya29.umTokenLongoDeVerdade123456 no cabecalho');
    assert.ok(!limpo.includes('ya29.umTokenLongoDeVerdade123456'));
    assert.match(limpo, /falhou com \[redigido\] no cabecalho/);
  });

  it('preserva a mensagem do Google, que e o motivo de existir', () => {
    const corpo = JSON.stringify({
      error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Developer token not approved' },
    });
    const limpo = redactText(corpo);

    assert.match(limpo, /INVALID_ARGUMENT/);
    assert.match(limpo, /Developer token not approved/);
  });

  it('nao estraga texto sem segredo', () => {
    assert.equal(redactText('sem nada aqui'), 'sem nada aqui');
  });
  it('esconde Bearer e JWT, e reduz e-mail ao domínio', () => {
    const limpo = redactText(
      'falhou com Authorization: Bearer abcDEF123456xyz para dona@cliente.com.br, id_token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlLXJlYWw',
    );

    assert.ok(!limpo.includes('abcDEF123456xyz'));
    assert.ok(!limpo.includes('eyJzdWIiOiIxMjM0NTYifQ'));
    assert.ok(!limpo.includes('dona@'));
    assert.match(limpo, /d\*\*\*@cliente\.com\.br/);
  });

  it('não confunde ID numérico de conta com dado sensível', () => {
    assert.equal(redactText('conta 346-633-6997 e act_1234567890'), 'conta 346-633-6997 e act_1234567890');
  });
});
