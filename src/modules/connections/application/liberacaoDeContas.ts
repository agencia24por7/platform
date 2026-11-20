import type { Ator } from '@/modules/audit/domain/actor';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type {
  ContaLiberada,
  DiscoveredAccountRepository,
} from '@/modules/connections/infrastructure/discoveredAccountRepository';

export const MOTIVO_DA_LIBERACAO = 'connection.removed';

type DonoDaConta = {
  findById(organizationId: string, id: string): Promise<{ readonly id: string; readonly name: string } | null>;
};

export async function liberarContasDaConexao(
  contas: Pick<DiscoveredAccountRepository, 'liberarDaConexao'>,
  clientes: DonoDaConta,
  audit: Pick<AuditRecorder, 'record'>,
  input: { readonly organizationId: string; readonly connectionId: string },
  ator: Ator,
): Promise<readonly ContaLiberada[]> {
  const liberadas = await contas.liberarDaConexao(input.organizationId, input.connectionId);
  const nomes = new Map<string, string>();

  for (const conta of liberadas) {
    if (!nomes.has(conta.clientIdAnterior)) {
      const cliente = await clientes.findById(input.organizationId, conta.clientIdAnterior);
      nomes.set(conta.clientIdAnterior, cliente?.name ?? conta.clientIdAnterior);
    }

    await audit.record({
      organizationId: input.organizationId,
      actorType: 'user',
      actorId: ator.userId,
      action: 'connection_account.unlink',
      targetType: 'connection_account',
      targetId: conta.id,
      requestId: ator.requestId,
      sourceIp: ator.sourceIp,
      metadata: {
        platform: conta.platform,
        externalId: conta.externalId,
        connectionId: conta.connectionId,
        de: nomes.get(conta.clientIdAnterior),
        deId: conta.clientIdAnterior,
        motivo: MOTIVO_DA_LIBERACAO,
      },
    });
  }

  return liberadas;
}
