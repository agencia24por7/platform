import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { comRequestId } from './comRequestId.ts';

const erros: { mensagem: string; contexto: Record<string, unknown> | undefined }[] = [];
const log = { error: (mensagem: string, contexto?: Record<string, unknown>) => void erros.push({ mensagem, contexto }) };

describe('comRequestId', () => {
  it('põe X-Request-Id na resposta normal', async () => {
    const resposta = await comRequestId('req-12345678', Promise.resolve(Response.json({ ok: true })), log);
    assert.equal(resposta.headers.get('X-Request-Id'), 'req-12345678');
    assert.equal(resposta.status, 200);
  });

  it('se o handler lançar, devolve 500 com o cabeçalho e loga sem a mensagem do erro', async () => {
    erros.length = 0;
    const resposta = await comRequestId('req-12345678', Promise.reject(new TypeError('dado sensivel@x.com')), log);
    assert.equal(resposta.status, 500);
    assert.equal(resposta.headers.get('X-Request-Id'), 'req-12345678');
    assert.equal(erros.length, 1);
    assert.deepEqual(erros[0]?.contexto, { requestId: 'req-12345678', erro: 'TypeError' });
    assert.ok(!JSON.stringify(erros).includes('sensivel'));
  });
});
