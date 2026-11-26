import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LIMITE_DE_REUSO_POR_JANELA, auditarPortaria } from './auditarPortaria.ts';
import { TETO_POR_DOMINIO, consume } from '../../../shared/security/rateLimit.ts';
import type { AuditEvent } from '../../audit/domain/auditEvent.ts';

function recorderEspiao() {
  const gravados: AuditEvent[] = [];
  return { gravados, recorder: { record: async (e: AuditEvent) => void gravados.push(e) } };
}

describe('auditarPortaria', () => {
  it('grava aberta com ator e resultado, sem token', async () => {
    const { gravados, recorder } = recorderEspiao();
    await auditarPortaria(recorder, { resultado: 'aberta', userId: 'u-ok', requestId: 'req-12345678', sourceIp: '203.0.113.9' });
    assert.deepEqual(gravados, [
      {
        organizationId: null,
        actorType: 'user',
        actorId: 'u-ok',
        action: 'n8n.portaria',
        requestId: 'req-12345678',
        sourceIp: '203.0.113.9',
        metadata: { resultado: 'aberta' },
      },
    ]);
  });

  it('limita o reuso por usuário e não limita aberta', async () => {
    const { gravados, recorder } = recorderEspiao();
    for (let i = 0; i < LIMITE_DE_REUSO_POR_JANELA + 5; i += 1) {
      await auditarPortaria(recorder, { resultado: 'reuso', userId: 'u-reuso', requestId: 'req-12345678', sourceIp: null });
    }
    assert.equal(gravados.length, LIMITE_DE_REUSO_POR_JANELA);
    await auditarPortaria(recorder, { resultado: 'aberta', userId: 'u-reuso', requestId: 'req-12345678', sourceIp: null });
    assert.equal(gravados.length, LIMITE_DE_REUSO_POR_JANELA + 1);
  });

  it('a falha da auditoria não propaga', async () => {
    await auditarPortaria({ record: () => Promise.reject(new Error('x')) }, { resultado: 'indisponivel', userId: 'u-1', requestId: 'req-12345678', sourceIp: null });
  });

  it('com o limitador de segurança lotado, o reuso ainda grava e ainda tem teto', async () => {
    for (let i = 0; i < TETO_POR_DOMINIO.publico + 100; i += 1) consume('publico', `lotacao-teste:${i}`, 1, 600_000);
    const { gravados, recorder } = recorderEspiao();
    for (let i = 0; i < LIMITE_DE_REUSO_POR_JANELA + 5; i += 1) {
      await auditarPortaria(recorder, { resultado: 'reuso', userId: 'u-lotado', requestId: 'req-12345678', sourceIp: null });
    }
    assert.equal(gravados.length, LIMITE_DE_REUSO_POR_JANELA);
  });
});
