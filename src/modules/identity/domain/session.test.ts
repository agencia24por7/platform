import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHmac } from 'node:crypto';
import { SESSION_MAX_AGE_SECONDS, issueSession, readSession } from './session.ts';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const USUARIO = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const AGORA = 1_700_000_000_000;

describe('sessão assinada', () => {
  it('ida e volta devolve o usuário', () => {
    const sessao = readSession(issueSession(USUARIO, SEGREDO, AGORA), SEGREDO, AGORA);
    assert.equal(sessao?.userId, USUARIO);
  });

  it('recusa assinatura de outro segredo', () => {
    const token = issueSession(USUARIO, 'outro-segredo-bem-longo-para-teste', AGORA);
    assert.equal(readSession(token, SEGREDO, AGORA), null);
  });

  it('recusa corpo adulterado mantendo a assinatura', () => {
    const token = issueSession(USUARIO, SEGREDO, AGORA);
    const assinatura = token.slice(token.lastIndexOf('.') + 1);
    const outroUsuario = '00000000-0000-4000-8000-000000000000';
    const corpo = Buffer.from(
      JSON.stringify({ userId: outroUsuario, issuedAt: AGORA, expiresAt: AGORA + 1000 }),
    ).toString('base64url');

    assert.equal(readSession(`${corpo}.${assinatura}`, SEGREDO, AGORA), null);
  });

  it('recusa sessão expirada', () => {
    const token = issueSession(USUARIO, SEGREDO, AGORA);
    const depois = AGORA + SESSION_MAX_AGE_SECONDS * 1000 + 1;
    assert.equal(readSession(token, SEGREDO, depois), null);
  });

  it('recusa validade esticada além do teto', () => {
    const corpo = Buffer.from(
      JSON.stringify({ userId: USUARIO, issuedAt: AGORA, expiresAt: AGORA + 10 * 365 * 24 * 3600 * 1000 }),
    ).toString('base64url');
    const assinatura = createHmac('sha256', SEGREDO).update(corpo).digest('base64url');

    assert.equal(readSession(`${corpo}.${assinatura}`, SEGREDO, AGORA), null);
  });

  it('recusa identificador que não é uuid', () => {
    const corpo = Buffer.from(
      JSON.stringify({ userId: 'admin', issuedAt: AGORA, expiresAt: AGORA + 1000 }),
    ).toString('base64url');
    const assinatura = createHmac('sha256', SEGREDO).update(corpo).digest('base64url');

    assert.equal(readSession(`${corpo}.${assinatura}`, SEGREDO, AGORA), null);
  });

  it('recusa lixo', () => {
    assert.equal(readSession('', SEGREDO, AGORA), null);
    assert.equal(readSession('semponto', SEGREDO, AGORA), null);
    assert.equal(readSession('.abc', SEGREDO, AGORA), null);
  });
});
