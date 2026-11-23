import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JANELA_DA_LEITURA_MS, deveRegistrarLeitura, registrarLeituraDeCliente } from './registrarLeituraDeCliente.ts';
import { consume } from '../../../shared/security/rateLimit.ts';
import type { AuditEvent } from '../../audit/domain/auditEvent.ts';

const leitura = { organizationId: 'org-1', userId: 'user-1', clientId: 'cli-1', requestId: 'req-12345678' };

describe('registrarLeituraDeCliente', () => {
  it('grava cliente.leitura com id do cliente e sem conteúdo', async () => {
    const gravados: AuditEvent[] = [];
    await registrarLeituraDeCliente({ record: async (e) => void gravados.push(e) }, leitura);
    assert.deepEqual(gravados, [
      {
        organizationId: 'org-1',
        actorType: 'user',
        actorId: 'user-1',
        action: 'cliente.leitura',
        targetType: 'client',
        targetId: 'cli-1',
        requestId: 'req-12345678',
      },
    ]);
  });

  it('a falha da auditoria não derruba a leitura', async () => {
    await registrarLeituraDeCliente({ record: () => Promise.reject(new Error('banco fora')) }, leitura);
  });
});

function lotarLimitadorDeSeguranca(): void {
  for (let i = 0; i < 10_100; i += 1) consume(`lotacao-teste:${i}`, 1, 600_000);
}

describe('deveRegistrarLeitura', () => {
  it('permite a primeira leitura e bloqueia a repetição na janela', () => {
    assert.equal(deveRegistrarLeitura('u-dedup', 'c-dedup'), true);
    assert.equal(deveRegistrarLeitura('u-dedup', 'c-dedup'), false);
    assert.equal(deveRegistrarLeitura('u-dedup', 'c-dedup'), false);
  });

  it('separa por usuário e por cliente', () => {
    assert.equal(deveRegistrarLeitura('u-a', 'c-1'), true);
    assert.equal(deveRegistrarLeitura('u-b', 'c-1'), true);
    assert.equal(deveRegistrarLeitura('u-a', 'c-2'), true);
  });

  it('com o limitador de segurança lotado, ainda registra e ainda deduplica', () => {
    lotarLimitadorDeSeguranca();
    assert.equal(deveRegistrarLeitura('u-lotado', 'c-lotado'), true);
    assert.equal(deveRegistrarLeitura('u-lotado', 'c-lotado'), false);
  });

  it('a janela é de 60 segundos', () => {
    assert.equal(JANELA_DA_LEITURA_MS, 60_000);
  });
});
