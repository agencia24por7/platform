import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { ContextoDeCifra } from '@/modules/tokens/domain/token';

const { createCifraEnvelope } = await import('./envelope.ts');
const { createChaveMestraLocal, escolherChaveMestra, CofreIndisponivel } = await import('./chavesMestras.ts');
const { comProvedorDeTeste, acessoDeTeste } = await import('./provedorDeTeste.ts');

const CONTEXTO: ContextoDeCifra = { connectionId: 'c-1', platform: 'google', finalidade: 'segredo' };
const SEGREDO_DE_SESSAO = 's'.repeat(40);

describe('cifra por envelope', () => {
  it('ida e volta, com envelope diferente a cada cifragem e sem texto claro', async () => {
    const cifra = createCifraEnvelope(createChaveMestraLocal(SEGREDO_DE_SESSAO));
    const a = await cifra.cifrar('1//refresh', CONTEXTO);
    const b = await cifra.cifrar('1//refresh', CONTEXTO);
    assert.notDeepEqual(a.bytes, b.bytes);
    assert.equal(a.algoritmo, 'aes-256-gcm+local');
    assert.equal(a.versaoDaChave, 'local:v1');
    assert.ok(!a.bytes.toString('latin1').includes('1//refresh'));
    assert.equal(await cifra.decifrar(a.bytes, CONTEXTO), '1//refresh');
  });

  it('recusa AAD trocado: outra conexão, outra plataforma ou outra finalidade', async () => {
    const cifra = createCifraEnvelope(createChaveMestraLocal(SEGREDO_DE_SESSAO));
    const { bytes } = await cifra.cifrar('segredo', CONTEXTO);
    for (const outro of [
      { ...CONTEXTO, connectionId: 'c-2' },
      { ...CONTEXTO, platform: 'meta' as const },
      { ...CONTEXTO, finalidade: 'acesso' as const },
    ]) {
      await assert.rejects(cifra.decifrar(bytes, outro));
    }
  });

  it('recusa envelope adulterado e chave mestra diferente', async () => {
    const cifra = createCifraEnvelope(createChaveMestraLocal(SEGREDO_DE_SESSAO));
    const { bytes } = await cifra.cifrar('segredo', CONTEXTO);
    const adulterado = Buffer.from(bytes);
    adulterado[adulterado.length - 1] = (adulterado[adulterado.length - 1] ?? 0) ^ 1;
    await assert.rejects(cifra.decifrar(adulterado, CONTEXTO));
    await assert.rejects(createCifraEnvelope(createChaveMestraLocal('t'.repeat(40))).decifrar(bytes, CONTEXTO));
  });
});

describe('escolha da chave mestra', () => {
  it('produção sem TOKENS_KMS_KEY falha fechado, nunca cai na chave local', async () => {
    const chave = escolherChaveMestra({ NODE_ENV: 'production', TRIA_SESSION_SECRET: SEGREDO_DE_SESSAO });
    assert.equal(chave.algoritmo, 'aes-256-gcm+kms');
    await assert.rejects(chave.embrulhar(Buffer.alloc(32), Buffer.from('aad')), CofreIndisponivel);
    await assert.rejects(createCifraEnvelope(chave).cifrar('x', CONTEXTO), CofreIndisponivel);
  });

  it('fora de produção sem chave usa a local', () => {
    assert.equal(escolherChaveMestra({ NODE_ENV: 'development', TRIA_SESSION_SECRET: SEGREDO_DE_SESSAO }).algoritmo, 'aes-256-gcm+local');
  });

  it('com TOKENS_KMS_KEY embrulha no KMS passando a AAD e grava a versão usada', async () => {
    const nome = 'projects/p/locations/us-central1/keyRings/tria-prod-tokens/cryptoKeys/conexoes';
    const pedidos: { name: string; aad: string }[] = [];
    const chave = escolherChaveMestra({ NODE_ENV: 'production', TOKENS_KMS_KEY: nome, TRIA_SESSION_SECRET: SEGREDO_DE_SESSAO }, async () => ({
      async encrypt(pedido) {
        pedidos.push({ name: pedido.name, aad: pedido.additionalAuthenticatedData.toString() });
        return [{ ciphertext: Buffer.concat([Buffer.from('K'), pedido.plaintext]), name: `${nome}/cryptoKeyVersions/3` }];
      },
      async decrypt(pedido) {
        pedidos.push({ name: pedido.name, aad: pedido.additionalAuthenticatedData.toString() });
        return [{ plaintext: pedido.ciphertext.subarray(1) }];
      },
    }));
    const cifra = createCifraEnvelope(chave);
    const cifrado = await cifra.cifrar('segredo', CONTEXTO);
    assert.equal(cifrado.versaoDaChave, `${nome}/cryptoKeyVersions/3`);
    assert.equal(cifrado.algoritmo, 'aes-256-gcm+kms');
    assert.equal(await cifra.decifrar(cifrado.bytes, CONTEXTO), 'segredo');
    assert.deepEqual(pedidos.map((p) => p.name), [nome, nome]);
    assert.ok(pedidos.every((p) => p.aad === 'orla.tokens.v1|c-1|google|segredo'));
  });
});

describe('provedor de teste', () => {
  const real = () => ({
    renovar: async () => ({ ok: false as const, error: { natureza: 'transitoria' as const, codigo: 'real' } }),
    revogar: async () => ({ ok: true as const, value: 'revogado' as const }),
  });

  it('em produção nunca é composto', async () => {
    const fabrica = comProvedorDeTeste(real, 'production');
    const resultado = await fabrica('google', 'oauth_refresh')!.renovar('orla-teste:qualquer');
    assert.deepEqual(resultado, { ok: false, error: { natureza: 'transitoria', codigo: 'real' } });
  });

  it('fora de produção só responde a segredos com o prefixo de teste', async () => {
    const fabrica = comProvedorDeTeste(real, 'development');
    const falso = await fabrica('google', 'oauth_refresh')!.renovar('orla-teste:abc');
    assert.ok(falso.ok);
    assert.equal(falso.value.accessToken, acessoDeTeste('orla-teste:abc'));
    const semPrefixo = await fabrica('google', 'oauth_refresh')!.renovar('1//real');
    assert.equal(semPrefixo.ok, false);
  });
});
