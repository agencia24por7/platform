import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  HANDOFF_TTL_SECONDS,
  PORTARIA_SESSAO_SEGUNDOS,
  issueHandoff,
  issuePortariaSession,
  readHandoff,
  readPortariaSession,
} from './handoff.ts';
import { issueSession, readSession } from './session.ts';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const USUARIO = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const AGORA = 1_700_000_000_000;

const assinar = (corpo: string, segredo = SEGREDO) =>
  `${corpo}.${createHmac('sha256', segredo).update(corpo).digest('base64url')}`;

const JTI = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

const corpoDe = (dados: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(dados)).toString('base64url');

describe('passagem para a automação', () => {
  it('ida e volta devolve o usuário', () => {
    assert.equal(readHandoff(issueHandoff(USUARIO, SEGREDO, AGORA), SEGREDO, AGORA)?.userId, USUARIO);
  });

  it('vale por pouco tempo', () => {
    const token = issueHandoff(USUARIO, SEGREDO, AGORA);
    assert.equal(readHandoff(token, SEGREDO, AGORA + HANDOFF_TTL_SECONDS * 1000 + 1), null);
  });

  it('recusa validade esticada além do teto', () => {
    const corpo = corpoDe({ userId: USUARIO, audience: 'n8n', jti: JTI, expiresAt: AGORA + 86_400_000 });
    assert.equal(readHandoff(assinar(corpo), SEGREDO, AGORA), null);
  });

  it('recusa assinatura de outro segredo', () => {
    const token = issueHandoff(USUARIO, 'outro-segredo-bem-longo-para-teste', AGORA);
    assert.equal(readHandoff(token, SEGREDO, AGORA), null);
  });

  it('recusa passagem emitida para outro destino', () => {
    const corpo = corpoDe({ userId: USUARIO, audience: 'outro-servico', jti: JTI, expiresAt: AGORA + 10_000 });
    assert.equal(readHandoff(assinar(corpo), SEGREDO, AGORA), null);
  });

  it('recusa identificador que não é uuid', () => {
    const corpo = corpoDe({ userId: 'admin', audience: 'n8n', jti: JTI, expiresAt: AGORA + 10_000 });
    assert.equal(readHandoff(assinar(corpo), SEGREDO, AGORA), null);
  });

  it('recusa corpo trocado com assinatura antiga', () => {
    const valido = issueHandoff(USUARIO, SEGREDO, AGORA);
    const assinatura = valido.slice(valido.lastIndexOf('.') + 1);
    const outro = corpoDe({
      userId: '00000000-0000-4000-8000-000000000000',
      audience: 'n8n',
      jti: JTI,
      expiresAt: AGORA + 10_000,
    });
    assert.equal(readHandoff(`${outro}.${assinatura}`, SEGREDO, AGORA), null);
  });

  it('cada passagem tem identificador proprio, para gastar uma so vez', () => {
    const a = readHandoff(issueHandoff(USUARIO, SEGREDO, AGORA), SEGREDO, AGORA);
    const b = readHandoff(issueHandoff(USUARIO, SEGREDO, AGORA), SEGREDO, AGORA);
    assert.notEqual(a?.jti, b?.jti);
  });

  it('recusa passagem sem identificador', () => {
    const corpo = corpoDe({ userId: USUARIO, audience: 'n8n', expiresAt: AGORA + 10_000 });
    assert.equal(readHandoff(assinar(corpo), SEGREDO, AGORA), null);
  });

  it('recusa lixo', () => {
    assert.equal(readHandoff('', SEGREDO, AGORA), null);
    assert.equal(readHandoff('semponto', SEGREDO, AGORA), null);
  });
});

describe('sessão da portaria', () => {
  it('ida e volta devolve usuário e emissão', () => {
    const lida = readPortariaSession(issuePortariaSession(USUARIO, SEGREDO, AGORA), SEGREDO, AGORA);
    assert.deepEqual(lida, { userId: USUARIO, issuedAt: AGORA });
  });

  it('não é aceita como sessão do app', () => {
    assert.equal(readSession(issuePortariaSession(USUARIO, SEGREDO, AGORA), SEGREDO, AGORA), null);
  });

  it('sessão do app não abre a portaria', () => {
    assert.equal(readPortariaSession(issueSession(USUARIO, SEGREDO, AGORA), SEGREDO, AGORA), null);
  });

  it('passagem de uso único não vira sessão da portaria', () => {
    assert.equal(readPortariaSession(issueHandoff(USUARIO, SEGREDO, AGORA), SEGREDO, AGORA), null);
  });

  it('expira no teto da portaria', () => {
    const token = issuePortariaSession(USUARIO, SEGREDO, AGORA);
    assert.equal(readPortariaSession(token, SEGREDO, AGORA + PORTARIA_SESSAO_SEGUNDOS * 1000 + 1), null);
  });

  it('recusa assinatura de outro segredo', () => {
    assert.equal(readPortariaSession(issuePortariaSession(USUARIO, 'outro-segredo-com-mais-de-32-caracteres', AGORA), SEGREDO, AGORA), null);
  });
});
