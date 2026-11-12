import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOTIVO_DO_CONVITE_DE_INTEGRACAO,
  PLATAFORMAS_CONVIDAVEIS,
  conviteExpirado,
  convidavelPorLink,
  expiracaoPadrao,
  gerarTokenDeConvite,
  validarPlataformasEscolhidas,
} from './integrationInvite.ts';

test('google e meta não entram no convite por link — já têm caminho próprio', () => {
  assert.equal(convidavelPorLink('google'), false);
  assert.equal(convidavelPorLink('meta'), false);
});

test('as sete plataformas OAuth sem caminho de administradora são convidáveis', () => {
  for (const platform of PLATAFORMAS_CONVIDAVEIS) {
    assert.equal(convidavelPorLink(platform), true);
  }
});

test('apify, zapi e rdstation ainda não entram — são conexão única por organização', () => {
  assert.equal(convidavelPorLink('apify'), false);
  assert.equal(convidavelPorLink('zapi'), false);
  assert.equal(convidavelPorLink('rdstation'), false);
});

test('o token tem alta entropia e não se repete', () => {
  const um = gerarTokenDeConvite();
  const outro = gerarTokenDeConvite();
  assert.ok(um.length >= 24);
  assert.notEqual(um, outro);
});

test('expira em 7 dias a partir de agora', () => {
  const agora = new Date('2026-01-01T00:00:00Z');
  const expira = expiracaoPadrao(agora);
  assert.equal(expira.getTime() - agora.getTime(), 7 * 24 * 60 * 60 * 1000);
});

test('convite expirado é reconhecido pela data, não pelo status', () => {
  const agora = new Date('2026-01-10T00:00:00Z');
  assert.equal(conviteExpirado(new Date('2026-01-09T00:00:00Z'), agora), true);
  assert.equal(conviteExpirado(new Date('2026-01-11T00:00:00Z'), agora), false);
});

test('convite sem nenhuma plataforma escolhida é recusado', () => {
  const decisao = validarPlataformasEscolhidas([]);
  assert.deepEqual(decisao, { ok: false, motivo: 'vazio' });
});

test('plataforma repetida no mesmo convite é recusada', () => {
  const decisao = validarPlataformasEscolhidas(['ga4', 'ga4']);
  assert.deepEqual(decisao, { ok: false, motivo: 'duplicada' });
});

test('plataforma que não é convidável por link é recusada', () => {
  const decisao = validarPlataformasEscolhidas(['ga4', 'google']);
  assert.deepEqual(decisao, { ok: false, motivo: 'plataforma_invalida' });
});

test('plataformas válidas e únicas passam', () => {
  const decisao = validarPlataformasEscolhidas(['ga4', 'whatsapp']);
  assert.deepEqual(decisao, { ok: true, platforms: ['ga4', 'whatsapp'] });
});

test('toda motivo de recusa tem uma mensagem', () => {
  for (const motivo of Object.keys(MOTIVO_DO_CONVITE_DE_INTEGRACAO)) {
    assert.ok(MOTIVO_DO_CONVITE_DE_INTEGRACAO[motivo as keyof typeof MOTIVO_DO_CONVITE_DE_INTEGRACAO].length > 0);
  }
});
