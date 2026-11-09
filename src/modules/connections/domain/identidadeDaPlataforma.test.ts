import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const FONTE = readFileSync('src/modules/connections/infrastructure/platformDiscovery.ts', 'utf8');

test('a identificação é por plataforma declarada, nunca por fallback', () => {
  assert.ok(
    FONTE.includes('const onde = ONDE_SE_IDENTIFICA[platform];'),
    'identify precisa consultar um mapa explícito',
  );
  assert.ok(
    FONTE.includes('if (!onde) {'),
    'plataforma sem endereço de identidade precisa devolver null, não cair em outro host',
  );
  assert.ok(
    !/platform === 'google'\s*\n?\s*\?\s*'https:\/\/www\.googleapis/.test(FONTE),
    'o ternário que mandava todo o resto para o Graph do Facebook não pode voltar',
  );
});

test('cada plataforma aponta para o próprio host', () => {
  const mapa = FONTE.slice(
    FONTE.indexOf('const ONDE_SE_IDENTIFICA'),
    FONTE.indexOf('export function createPlatformDiscovery'),
  );

  const linhaDo = (plataforma: string) =>
    mapa.split('\n').find((linha) => linha.trim().startsWith(`${plataforma}:`)) ?? '';

  assert.match(linhaDo('google'), /googleapis\.com/);
  assert.match(linhaDo('meta'), /GRAPH_API|graph\.facebook\.com/);
  assert.match(linhaDo('rdstation'), /api\.rd\.services/);
  assert.ok(!linhaDo('rdstation').includes('graph.facebook'), 'token do RD não pode ir para a Meta');
});

test('a credencial só é guardada depois de saber quem autorizou', () => {
  const servico = readFileSync(
    'src/modules/connections/application/authorizationService.ts',
    'utf8',
  );

  assert.ok(
    servico.indexOf('discovery.identify(') < servico.indexOf('vault.store({'),
    'guardar antes de identificar deixa credencial órfã no cofre quando a identificação falha',
  );
});
