import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { ContaLiberada } from '@/modules/connections/infrastructure/discoveredAccountRepository';
import { MOTIVO_DA_LIBERACAO, liberarContasDaConexao } from './liberacaoDeContas.ts';

const ator = { userId: 'u1', requestId: 'r1', sourceIp: null };
const pedido = { organizationId: 'org1', connectionId: 'conn1' };

const conta = (id: string, clientIdAnterior: string): ContaLiberada => ({
  id,
  connectionId: 'conn1',
  platform: 'rdstation',
  externalId: `ext-${id}`,
  name: 'RD Station · abcd…wxyz',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  managerExternalId: null,
  inactive: false,
  spendingLast30Days: null,
  state: 'discovered',
  clientId: null,
  clientIdAnterior,
});

function cenario(liberadas: readonly ContaLiberada[]) {
  const eventos: AuditEvent[] = [];
  const consultasDeCliente: string[] = [];
  const pedidos: string[] = [];
  const deps = {
    contas: {
      async liberarDaConexao(organizationId: string, connectionId: string) {
        pedidos.push(`${organizationId}/${connectionId}`);
        return liberadas;
      },
    },
    clientes: {
      async findById(_organizationId: string, id: string) {
        consultasDeCliente.push(id);
        return id === 'credaz' ? { id, name: 'Credaz' } : null;
      },
    },
    audit: {
      async record(evento: AuditEvent) {
        eventos.push(evento);
      },
    },
  };
  return { deps, eventos, consultasDeCliente, pedidos };
}

describe('remover conexão libera as contas descobertas', () => {
  it('pede a liberação da conexão removida, na organização certa', async () => {
    const { deps, pedidos } = cenario([]);
    await liberarContasDaConexao(deps.contas, deps.clientes, deps.audit, pedido, ator);
    assert.deepEqual(pedidos, ['org1/conn1']);
  });

  it('sem conta vinculada não audita nada', async () => {
    const { deps, eventos } = cenario([]);
    const liberadas = await liberarContasDaConexao(deps.contas, deps.clientes, deps.audit, pedido, ator);
    assert.equal(liberadas.length, 0);
    assert.equal(eventos.length, 0);
  });

  it('audita cada conta como desvínculo, com o cliente anterior em "de" para fechar a posse no SCD2', async () => {
    const { deps, eventos } = cenario([conta('ca1', 'credaz')]);
    const liberadas = await liberarContasDaConexao(deps.contas, deps.clientes, deps.audit, pedido, ator);

    assert.equal(liberadas.length, 1);
    assert.equal(eventos.length, 1);
    const [evento] = eventos;
    assert.equal(evento!.action, 'connection_account.unlink');
    assert.equal(evento!.targetType, 'connection_account');
    assert.equal(evento!.targetId, 'ca1');
    assert.equal(evento!.actorId, 'u1');
    assert.deepEqual(evento!.metadata, {
      platform: 'rdstation',
      externalId: 'ext-ca1',
      connectionId: 'conn1',
      de: 'Credaz',
      motivo: MOTIVO_DA_LIBERACAO,
    });
  });

  it('consulta cada cliente uma vez e cai no id quando o cliente não existe mais', async () => {
    const { deps, eventos, consultasDeCliente } = cenario([
      conta('ca1', 'credaz'),
      conta('ca2', 'credaz'),
      conta('ca3', 'sumiu'),
    ]);
    await liberarContasDaConexao(deps.contas, deps.clientes, deps.audit, pedido, ator);

    assert.deepEqual(consultasDeCliente, ['credaz', 'sumiu']);
    assert.deepEqual(
      eventos.map((evento) => evento.metadata?.de),
      ['Credaz', 'Credaz', 'sumiu'],
    );
  });
});
