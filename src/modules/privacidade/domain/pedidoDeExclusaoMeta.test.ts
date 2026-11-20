import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  CODIGO_DE_CONFIRMACAO,
  JANELA_DE_EMISSAO_SEGUNDOS,
  lerSignedRequest,
  novoCodigoDeConfirmacao,
  pseudonimoDoUsuarioDaMeta,
} from './pedidoDeExclusaoMeta.ts';

const SEGREDO = 'segredo-do-app-da-meta';
const AGORA = 1_795_000_000;

function assinar(carga: Record<string, unknown>, segredo = SEGREDO): string {
  const cargaCodificada = Buffer.from(JSON.stringify(carga)).toString('base64url');
  const assinatura = createHmac('sha256', segredo).update(cargaCodificada).digest('base64url');
  return `${assinatura}.${cargaCodificada}`;
}

const valido = { algorithm: 'HMAC-SHA256', issued_at: AGORA - 10, user_id: '1234567890' };

describe('signed_request do callback de exclusão da Meta', () => {
  it('aceita assinatura válida e devolve o usuário', () => {
    assert.deepEqual(lerSignedRequest(assinar(valido), SEGREDO, AGORA), { ok: true, usuarioDaMeta: '1234567890' });
  });

  it('aceita user_id numérico', () => {
    assert.deepEqual(lerSignedRequest(assinar({ ...valido, user_id: 987 }), SEGREDO, AGORA), { ok: true, usuarioDaMeta: '987' });
  });

  it('recusa assinatura feita com outro segredo', () => {
    assert.deepEqual(lerSignedRequest(assinar(valido, 'outro-segredo'), SEGREDO, AGORA), { ok: false, motivo: 'assinatura_invalida' });
  });

  it('recusa carga adulterada depois de assinada', () => {
    const [assinatura] = assinar(valido).split('.');
    const adulterada = Buffer.from(JSON.stringify({ ...valido, user_id: '999' })).toString('base64url');
    assert.deepEqual(lerSignedRequest(`${assinatura}.${adulterada}`, SEGREDO, AGORA), { ok: false, motivo: 'assinatura_invalida' });
  });

  it('recusa assinatura truncada sem estourar a comparação de tempo constante', () => {
    const [assinatura, carga] = assinar(valido).split('.');
    assert.deepEqual(lerSignedRequest(`${assinatura!.slice(0, 10)}.${carga}`, SEGREDO, AGORA), { ok: false, motivo: 'assinatura_invalida' });
  });

  it('recusa algoritmo diferente de HMAC-SHA256', () => {
    assert.deepEqual(lerSignedRequest(assinar({ ...valido, algorithm: 'none' }), SEGREDO, AGORA), { ok: false, motivo: 'algoritmo_invalido' });
    assert.deepEqual(lerSignedRequest(assinar({ ...valido, algorithm: undefined }), SEGREDO, AGORA), { ok: false, motivo: 'algoritmo_invalido' });
  });

  it('recusa formato quebrado', () => {
    for (const quebrado of ['', 'sem-ponto', 'a.b.c', 'a b.c', `${'x'.repeat(5000)}.y`]) {
      assert.deepEqual(lerSignedRequest(quebrado, SEGREDO, AGORA), { ok: false, motivo: 'formato_invalido' }, quebrado.slice(0, 20));
    }
  });

  it('recusa usuário ausente ou fora do formato', () => {
    assert.deepEqual(lerSignedRequest(assinar({ ...valido, user_id: undefined }), SEGREDO, AGORA), { ok: false, motivo: 'usuario_invalido' });
    assert.deepEqual(lerSignedRequest(assinar({ ...valido, user_id: "1' OR 1=1" }), SEGREDO, AGORA), { ok: false, motivo: 'usuario_invalido' });
  });

  it('recusa aviso reapresentado fora da janela de emissão, ou do futuro', () => {
    const velho = assinar({ ...valido, issued_at: AGORA - JANELA_DE_EMISSAO_SEGUNDOS - 1 });
    const futuro = assinar({ ...valido, issued_at: AGORA + 3600 });
    const semData = assinar({ ...valido, issued_at: undefined });
    for (const pedido of [velho, futuro, semData]) {
      assert.deepEqual(lerSignedRequest(pedido, SEGREDO, AGORA), { ok: false, motivo: 'emitido_fora_da_janela' });
    }
  });
});

describe('pseudônimo e código de confirmação', () => {
  it('o pseudônimo é estável, depende da pimenta e não contém o id', () => {
    const a = pseudonimoDoUsuarioDaMeta('1234567890', 'pimenta');
    assert.equal(a, pseudonimoDoUsuarioDaMeta('1234567890', 'pimenta'));
    assert.notEqual(a, pseudonimoDoUsuarioDaMeta('1234567890', 'outra'));
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.ok(!a.includes('1234567890'));
  });

  it('o código de confirmação é aleatório e segue o formato aceito pela tabela', () => {
    const a = novoCodigoDeConfirmacao();
    assert.match(a, CODIGO_DE_CONFIRMACAO);
    assert.notEqual(a, novoCodigoDeConfirmacao());
  });
});
