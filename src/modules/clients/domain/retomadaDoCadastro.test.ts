import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TAMANHO_MAXIMO_DA_RETOMADA, VALIDADE_DA_RETOMADA_MS, clienteDaRetomada, emitirRetomada } from './retomadaDoCadastro.ts';

const SEGREDO = 's'.repeat(40);
const AGORA = 1_800_000_000_000;
const DONO = { organizationId: '11111111-1111-4111-8111-111111111111', userId: '33333333-3333-4333-8333-333333333333' };
const CLIENTE = '22222222-2222-4222-8222-222222222222';

describe('retomada do cadastro', () => {
  it('devolve o cliente para a mesma organização e pessoa dentro da validade', () => {
    const token = emitirRetomada(DONO, CLIENTE, SEGREDO, AGORA);
    assert.equal(clienteDaRetomada(token, DONO, SEGREDO, AGORA + 1000), CLIENTE);
    assert.ok(token.length <= TAMANHO_MAXIMO_DA_RETOMADA);
  });

  it('recusa outra organização, outra pessoa, outro segredo e prazo vencido', () => {
    const token = emitirRetomada(DONO, CLIENTE, SEGREDO, AGORA);
    assert.equal(clienteDaRetomada(token, { ...DONO, organizationId: '44444444-4444-4444-8444-444444444444' }, SEGREDO, AGORA), null);
    assert.equal(clienteDaRetomada(token, { ...DONO, userId: '55555555-5555-4555-8555-555555555555' }, SEGREDO, AGORA), null);
    assert.equal(clienteDaRetomada(token, DONO, 'x'.repeat(40), AGORA), null);
    assert.equal(clienteDaRetomada(token, DONO, SEGREDO, AGORA + VALIDADE_DA_RETOMADA_MS), null);
  });

  it('recusa id cru, corpo adulterado, formato quebrado e valor que não é texto', () => {
    const token = emitirRetomada(DONO, CLIENTE, SEGREDO, AGORA);
    const [, assinatura] = token.split('.');
    const adulterado = `${Buffer.from(JSON.stringify({ o: DONO.organizationId, u: DONO.userId, c: '66666666-6666-4666-8666-666666666666', e: AGORA + 1e9 })).toString('base64url')}.${assinatura}`;
    for (const bruto of [CLIENTE, adulterado, '', '.', 'a.b', 'x'.repeat(TAMANHO_MAXIMO_DA_RETOMADA + 1), null, 42, ['a']]) {
      assert.equal(clienteDaRetomada(bruto, DONO, SEGREDO, AGORA), null, String(bruto).slice(0, 40));
    }
  });
});
